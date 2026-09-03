import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock('@/lib/db', () => ({
    prisma: { $queryRaw: mocks.queryRaw },
}));

import {
    AmplificationCreditFeedError,
    decodeAmplificationCreditCursor,
    encodeAmplificationCreditCursor,
    listAmplificationCreditEntries,
    parseAmplificationCreditFeedLimit,
    parseAmplificationCreditFeedQuery,
} from '@/lib/amplification-credit-feed';

const FIRST_ID = '70000000-0000-4000-8000-000000000001';
const SECOND_ID = '70000000-0000-4000-8000-000000000002';

function row(overrides: Record<string, unknown> = {}) {
    return {
        entry_id: FIRST_ID,
        scheduled_session_id: '10000000-0000-4000-8000-000000000001',
        ticket_entitlement_id: '50000000-0000-4000-8000-000000000001',
        registration_id: '20000000-0000-4000-8000-000000000001',
        email: 'ana@example.com',
        display_name: 'Ana',
        entered_at: new Date('2026-08-09T20:00:00.000Z'),
        ...overrides,
    };
}

function queryText(): string {
    const query = mocks.queryRaw.mock.calls.at(-1)?.[0] as { strings: readonly string[] };
    return query.strings.join('?').replace(/\s+/g, ' ');
}

describe('amplification credit cursor and limit', () => {
    it('round-trips the exact entered_at + entry_id position', () => {
        const cursor = {
            v: 1 as const,
            entered_at: '2026-08-09T20:00:00.000Z',
            entry_id: FIRST_ID,
        };
        expect(decodeAmplificationCreditCursor(encodeAmplificationCreditCursor(cursor))).toEqual(cursor);
        expect(decodeAmplificationCreditCursor(null)).toBeNull();
    });

    it('strictly rejects malformed, non-canonical, unknown-field and repeated cursors', () => {
        const invalid = [
            '',
            'not+base64url',
            Buffer.from('{"v":1,"entered_at":"not-a-date","entry_id":"bad"}').toString('base64url'),
            Buffer.from(JSON.stringify({
                v: 1,
                entered_at: '2026-08-09T20:00:00.000Z',
                entry_id: FIRST_ID,
                extra: true,
            })).toString('base64url'),
            Buffer.from(JSON.stringify({
                v: 2,
                entered_at: '2026-08-09T20:00:00.000Z',
                entry_id: FIRST_ID,
            })).toString('base64url'),
        ];
        for (const value of invalid) {
            expect(() => decodeAmplificationCreditCursor(value)).toThrowError(
                expect.objectContaining({ code: 'invalid_cursor', status: 400 }) as Error,
            );
        }
        expect(() => parseAmplificationCreditFeedQuery(
            new URLSearchParams('cursor=a&cursor=b'),
        )).toThrowError(expect.objectContaining({ code: 'invalid_request' }) as Error);
    });

    it('defaults to 50, accepts 1-100 and strictly rejects other limit spellings', () => {
        expect(parseAmplificationCreditFeedLimit(null)).toBe(50);
        expect(parseAmplificationCreditFeedLimit('1')).toBe(1);
        expect(parseAmplificationCreditFeedLimit('100')).toBe(100);
        for (const value of ['', '0', '01', '1.0', '-1', '101', 'abc']) {
            expect(() => parseAmplificationCreditFeedLimit(value)).toThrowError(
                expect.objectContaining({ code: 'invalid_limit', status: 400 }) as Error,
            );
        }
    });
});

describe('amplification credit feed query', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('filters staff, no-ticket and test sessions while retaining paid and free tickets', async () => {
        mocks.queryRaw.mockResolvedValue([
            row(),
            row({
                entry_id: SECOND_ID,
                registration_id: null,
                email: null,
                display_name: null,
                entered_at: new Date('2026-08-09T20:15:30.000Z'),
            }),
        ]);

        const page = await listAmplificationCreditEntries({ cursor: null, limit: 100 });

        const sql = queryText();
        expect(sql).toContain('"session"."is_test" = FALSE');
        expect(sql).toContain('"participant"."staff_user_id" IS NULL');
        expect(sql).toContain('"participant"."ticket_entitlement_id" IS NOT NULL');
        expect(sql).toContain('LEFT JOIN "commerce_entitlements" AS "commerce"');
        expect(page.entries).toHaveLength(2);
        expect(page.entries[1]).toMatchObject({
            registration_id: null,
            email: null,
            display_name: null,
        });
    });

    it('deduplicates reconnect intervals with MIN(started_at) per SessionParticipant', async () => {
        mocks.queryRaw.mockResolvedValue([row()]);

        const page = await listAmplificationCreditEntries({ cursor: null, limit: 50 });

        const sql = queryText();
        expect(sql).toContain('MIN("presence"."started_at") AS "entered_at"');
        expect(sql).toContain('GROUP BY "participant"."id"');
        expect(page.entries).toEqual([expect.objectContaining({
            entry_id: FIRST_ID,
            entered_at: '2026-08-09T20:00:00.000Z',
        })]);
    });

    it('orders and resumes strictly by entered_at then entry_id', async () => {
        mocks.queryRaw.mockResolvedValueOnce([
            row(),
            row({ entry_id: SECOND_ID }),
        ]);
        const first = await listAmplificationCreditEntries({ cursor: null, limit: 2 });
        const cursor = decodeAmplificationCreditCursor(first.next_cursor);
        expect(cursor).toEqual({
            v: 1,
            entered_at: '2026-08-09T20:00:00.000Z',
            entry_id: SECOND_ID,
        });
        expect(queryText()).toContain('ORDER BY "entered_at" ASC, "entry_id" ASC');

        mocks.queryRaw.mockResolvedValueOnce([]);
        const empty = await listAmplificationCreditEntries({ cursor, limit: 2 });
        expect(empty.entries).toEqual([]);
        expect(empty.next_cursor).toBe(first.next_cursor);
        expect(queryText()).toContain('"entered_at" > ? OR ("entered_at" = ? AND "entry_id" > ?::uuid)');
    });

    it('returns a durable cursor even when a non-empty page is the current tail', async () => {
        mocks.queryRaw.mockResolvedValue([row()]);
        const page = await listAmplificationCreditEntries({ cursor: null, limit: 100 });
        expect(page.next_cursor).not.toBeNull();
        expect(decodeAmplificationCreditCursor(page.next_cursor)).toMatchObject({ entry_id: FIRST_ID });
    });

    it('defends the database boundary against an unbounded internal caller', async () => {
        await expect(listAmplificationCreditEntries({ cursor: null, limit: 101 })).rejects.toMatchObject({
            code: 'invalid_limit',
            status: 400,
        });
        expect(mocks.queryRaw).not.toHaveBeenCalled();
    });

    it('surfaces only the expected feed error class for invalid input', () => {
        expect(() => parseAmplificationCreditFeedQuery(new URLSearchParams('unexpected=1')))
            .toThrowError(AmplificationCreditFeedError);
    });
});
