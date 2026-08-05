import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CONTRIBUTION_BODY_MAX_CHARS,
    ContributionError,
    contributionRequestDigest,
    createContribution,
    decodeContributionCursor,
    encodeContributionCursor,
    listPublicContributions,
    listStaffContributions,
    normalizeContributionBody,
    parseContributionVisibility,
    parseContributionsPageLimit,
    parseIdempotencyKey,
    toPublicContribution,
    toStaffContribution,
} from '@/lib/session-contributions';
import { contributionSubmissionLimiter } from '@/lib/contribution-rate-limit';
import type { SessionContribution } from '@prisma/client';

const mocks = vi.hoisted(() => ({
    participantFindFirst: vi.fn(),
    contributionFindUnique: vi.fn(),
    contributionCreate: vi.fn(),
    contributionFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        sessionParticipant: { findFirst: mocks.participantFindFirst },
        sessionContribution: {
            findUnique: mocks.contributionFindUnique,
            create: mocks.contributionCreate,
            findMany: mocks.contributionFindMany,
        },
    },
}));

function row(overrides: Partial<SessionContribution> = {}): SessionContribution {
    return {
        id: 'contrib-1',
        scheduledSessionId: 'session-1',
        authorParticipantId: 'participant-1',
        authorDisplayName: 'Ana',
        body: '¿Cómo respiramos juntas? Siento calma',
        visibility: 'NAMED',
        state: 'VISIBLE',
        idempotencyKey: 'key-1',
        requestDigest: 'a'.repeat(64),
        createdAt: new Date('2026-08-08T20:00:00.000Z'),
        updatedAt: new Date('2026-08-08T20:00:00.000Z'),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    contributionSubmissionLimiter.reset();
    mocks.participantFindFirst.mockResolvedValue({ id: 'participant-1' });
    mocks.contributionFindUnique.mockResolvedValue(null);
});

describe('normalizeContributionBody', () => {
    it('trims outer whitespace and collapses CRLF/CR to LF', () => {
        expect(normalizeContributionBody('  pregunta\r\nemoción\r ')).toBe('pregunta\nemoción');
    });

    it('rejects non-strings, empty and whitespace-only bodies', () => {
        expect(() => normalizeContributionBody(42)).toThrowError(ContributionError);
        expect(() => normalizeContributionBody('')).toThrowError(ContributionError);
        expect(() => normalizeContributionBody('   \n\t ')).toThrowError(ContributionError);
        try {
            normalizeContributionBody('');
        } catch (error) {
            expect((error as ContributionError).code).toBe('empty_body');
            expect((error as ContributionError).status).toBe(400);
        }
    });

    it('enforces the maximum length in Unicode code points, not UTF-16 units', () => {
        const emoji = '🪷'.repeat(CONTRIBUTION_BODY_MAX_CHARS);
        expect(normalizeContributionBody(emoji)).toBe(emoji);
        expect(() => normalizeContributionBody(emoji + 'a')).toThrowError(
            expect.objectContaining({ code: 'body_too_long' }) as Error,
        );
    });

    it('preserves Unicode and keeps markup as inert text', () => {
        const text = '<script>alert(1)</script> ¿Qué emoción habita? 平和 🕊️';
        expect(normalizeContributionBody(text)).toBe(text);
    });

    it('normalizes to NFC so visually identical text is byte-identical', () => {
        const composed = 'emoción';
        const decomposed = 'emocio\u0301n';
        expect(normalizeContributionBody(decomposed)).toBe(composed);
    });
});

describe('parseContributionVisibility', () => {
    it('accepts the two canonical visibilities and rejects everything else', () => {
        expect(parseContributionVisibility('NAMED')).toBe('NAMED');
        expect(parseContributionVisibility('ANONYMOUS')).toBe('ANONYMOUS');
        for (const bad of ['named', 'PUBLIC', '', null, undefined, 1]) {
            expect(() => parseContributionVisibility(bad)).toThrowError(
                expect.objectContaining({ code: 'invalid_visibility', status: 400 }) as Error,
            );
        }
    });
});

describe('parseIdempotencyKey', () => {
    it('accepts opaque keys within bounds and rejects the rest', () => {
        expect(parseIdempotencyKey('  abc-123_xyz  ')).toBe('abc-123_xyz');
        expect(() => parseIdempotencyKey('')).toThrowError(ContributionError);
        expect(() => parseIdempotencyKey('   ')).toThrowError(ContributionError);
        expect(() => parseIdempotencyKey('x'.repeat(129))).toThrowError(ContributionError);
        expect(() => parseIdempotencyKey(undefined)).toThrowError(ContributionError);
    });
});

describe('contributionRequestDigest', () => {
    it('binds visibility and the normalized body', () => {
        const named = contributionRequestDigest('NAMED', 'hola');
        const anonymous = contributionRequestDigest('ANONYMOUS', 'hola');
        expect(named).toMatch(/^[0-9a-f]{64}$/);
        expect(named).not.toBe(anonymous);
        expect(named).toBe(contributionRequestDigest('NAMED', 'hola'));
        // NFC-equivalent inputs digest identically after normalization.
        expect(
            contributionRequestDigest('NAMED', normalizeContributionBody('emocio\u0301n')),
        ).toBe(contributionRequestDigest('NAMED', 'emoción'));
    });
});

describe('contribution cursor', () => {
    it('round-trips and rejects malformed cursors with a 400', () => {
        const cursor = { createdAt: '2026-08-08T20:00:00.000Z', id: 'contrib-9' };
        expect(decodeContributionCursor(encodeContributionCursor(cursor))).toEqual(cursor);
        expect(decodeContributionCursor(null)).toBeNull();
        expect(decodeContributionCursor('')).toBeNull();
        expect(() => decodeContributionCursor('not-base64-json')).toThrowError(
            expect.objectContaining({ code: 'invalid_cursor', status: 400 }) as Error,
        );
        expect(() => decodeContributionCursor(
            Buffer.from('{"createdAt":"nope","id":"x"}').toString('base64url'),
        )).toThrowError(ContributionError);
    });
});

describe('parseContributionsPageLimit', () => {
    it('defaults, accepts bounded integers and rejects the rest', () => {
        expect(parseContributionsPageLimit(null)).toBe(50);
        expect(parseContributionsPageLimit('1')).toBe(1);
        expect(parseContributionsPageLimit('100')).toBe(100);
        for (const bad of ['0', '101', '-3', '1.5', 'abc']) {
            expect(() => parseContributionsPageLimit(bad)).toThrowError(
                expect.objectContaining({ code: 'invalid_limit', status: 400 }) as Error,
            );
        }
    });
});

describe('contribution DTO builders', () => {
    it('public NAMED shows the room display name with exactly the public fields', () => {
        const dto = toPublicContribution(row());
        expect(dto).toEqual({
            id: 'contrib-1',
            body: row().body,
            displayName: 'Ana',
            visibility: 'NAMED',
            createdAt: '2026-08-08T20:00:00.000Z',
        });
        // Nothing else: no participant/author/ticket/session identifiers,
        // not even null-valued.
        expect(Object.keys(dto).sort()).toEqual(
            ['body', 'createdAt', 'displayName', 'id', 'visibility'],
        );
    });

    it('public ANONYMOUS exposes no name and no author field of any kind', () => {
        const dto = toPublicContribution(row({ visibility: 'ANONYMOUS' }));
        expect(dto.displayName).toBeNull();
        expect(JSON.stringify(dto)).not.toContain('Ana');
        expect(JSON.stringify(dto)).not.toContain('participant');
        expect(Object.keys(dto).sort()).toEqual(
            ['body', 'createdAt', 'displayName', 'id', 'visibility'],
        );
    });

    it('staff DTO names the real author and how the audience sees the message', () => {
        const named = toStaffContribution({ ...row(), authorParticipant: { participantIdentity: 'lk-ticket-t1' } });
        expect(named).toEqual({
            id: 'contrib-1',
            body: row().body,
            authorDisplayName: 'Ana',
            participantIdentity: 'lk-ticket-t1',
            visibility: 'NAMED',
            audienceAnonymous: false,
            state: 'VISIBLE',
            createdAt: '2026-08-08T20:00:00.000Z',
        });
        const anonymous = toStaffContribution({
            ...row({ visibility: 'ANONYMOUS' }),
            authorParticipant: { participantIdentity: 'lk-ticket-t1' },
        });
        expect(anonymous.authorDisplayName).toBe('Ana');
        expect(anonymous.audienceAnonymous).toBe(true);
    });
});

describe('createContribution', () => {
    const base = {
        scheduledSessionId: 'session-1',
        ticketEntitlementId: 'ticket-1',
        displayName: 'Ana',
        body: '  ¿Cómo respiramos? Siento calma  ',
        visibility: 'NAMED',
        idempotencyKey: 'key-1',
    };

    it('creates a VISIBLE row with server-resolved identity and a name snapshot', async () => {
        const created = row({ body: '¿Cómo respiramos? Siento calma' });
        mocks.contributionCreate.mockResolvedValue(created);

        const result = await createContribution(base);

        expect(result.created).toBe(true);
        expect(result.contribution.id).toBe('contrib-1');
        expect(mocks.participantFindFirst).toHaveBeenCalledWith({
            where: { scheduledSessionId: 'session-1', ticketEntitlementId: 'ticket-1' },
            select: { id: true },
        });
        expect(mocks.contributionCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                scheduledSessionId: 'session-1',
                authorParticipantId: 'participant-1',
                authorDisplayName: 'Ana',
                body: '¿Cómo respiramos? Siento calma',
                visibility: 'NAMED',
                idempotencyKey: 'key-1',
                requestDigest: contributionRequestDigest('NAMED', '¿Cómo respiramos? Siento calma'),
            }),
        });
        // The client never supplied identity: only the resolved participant id.
        const data = mocks.contributionCreate.mock.calls[0][0].data;
        expect(Object.keys(data).sort()).toEqual([
            'authorDisplayName', 'authorParticipantId', 'body',
            'idempotencyKey', 'requestDigest', 'scheduledSessionId', 'visibility',
        ]);
    });

    it('returns the canonical row on an idempotent replay without writing', async () => {
        const existing = row();
        mocks.contributionFindUnique.mockResolvedValue({
            ...existing,
            requestDigest: contributionRequestDigest('NAMED', '¿Cómo respiramos? Siento calma'),
        });

        const result = await createContribution(base);

        expect(result.created).toBe(false);
        expect(result.contribution.id).toBe('contrib-1');
        expect(mocks.contributionCreate).not.toHaveBeenCalled();
    });

    it('rejects a reused key with a different payload', async () => {
        mocks.contributionFindUnique.mockResolvedValue(row());

        await expect(createContribution(base)).rejects.toMatchObject({
            code: 'idempotency_key_conflict',
            status: 409,
        });
        expect(mocks.contributionCreate).not.toHaveBeenCalled();
    });

    it('resolves a concurrent first submission through the unique-key race', async () => {
        const winner = row({
            requestDigest: contributionRequestDigest('NAMED', '¿Cómo respiramos? Siento calma'),
        });
        mocks.contributionFindUnique
            .mockResolvedValueOnce(null) // fast-path pre-check
            .mockResolvedValueOnce(winner); // re-read after the race
        const { Prisma } = await import('@prisma/client');
        mocks.contributionCreate.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                code: 'P2002',
                clientVersion: 'test',
            }),
        );

        const result = await createContribution(base);
        expect(result.created).toBe(false);
        expect(result.contribution.id).toBe('contrib-1');
    });

    it('rejects when the attendee has not joined the session', async () => {
        mocks.participantFindFirst.mockResolvedValue(null);

        await expect(createContribution(base)).rejects.toMatchObject({
            code: 'participant_not_joined',
            status: 409,
        });
        expect(mocks.contributionCreate).not.toHaveBeenCalled();
    });

    it('rate limits after the window budget and reports retryAfterSeconds', async () => {
        mocks.contributionCreate.mockImplementation(async ({ data }) => row({
            id: `contrib-${data.idempotencyKey}`,
            idempotencyKey: data.idempotencyKey,
            body: data.body,
            requestDigest: data.requestDigest,
        }));

        for (let i = 0; i < 5; i += 1) {
            await createContribution({ ...base, idempotencyKey: `key-${i}`, body: `mensaje ${i}` });
        }
        await expect(
            createContribution({ ...base, idempotencyKey: 'key-6', body: 'mensaje 6' }),
        ).rejects.toMatchObject({
            code: 'rate_limited',
            status: 429,
            details: { retryAfterSeconds: expect.any(Number) },
        });
        // The limited attempt never reached the database.
        expect(mocks.contributionCreate).toHaveBeenCalledTimes(5);
    });

    it('does not spend rate budget on replays or validation failures', async () => {
        const digest = contributionRequestDigest('NAMED', '¿Cómo respiramos? Siento calma');
        mocks.contributionFindUnique.mockResolvedValue(row({ requestDigest: digest }));
        for (let i = 0; i < 10; i += 1) {
            const result = await createContribution(base);
            expect(result.created).toBe(false);
        }
        await expect(createContribution({ ...base, body: '' })).rejects.toMatchObject({
            code: 'empty_body',
        });
        // A genuinely new submission still has budget afterwards.
        mocks.contributionFindUnique.mockResolvedValue(null);
        mocks.contributionCreate.mockResolvedValue(row({ id: 'contrib-new' }));
        const fresh = await createContribution({ ...base, idempotencyKey: 'key-fresh' });
        expect(fresh.created).toBe(true);
    });
});

describe('listPublicContributions', () => {
    it('lists only VISIBLE rows in stable order, bounded at limit + 1', async () => {
        mocks.contributionFindMany.mockResolvedValue([row()]);

        const page = await listPublicContributions({
            scheduledSessionId: 'session-1',
            cursor: null,
            limit: 50,
        });

        expect(mocks.contributionFindMany).toHaveBeenCalledWith({
            where: { scheduledSessionId: 'session-1', state: 'VISIBLE' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 51,
        });
        expect(page.contributions).toHaveLength(1);
        expect(page.nextCursor).toBeNull();
    });

    it('emits an opaque nextCursor only when more rows exist', async () => {
        const rows = [
            row({ id: 'c1', createdAt: new Date('2026-08-08T20:00:00.000Z') }),
            row({ id: 'c2', createdAt: new Date('2026-08-08T20:01:00.000Z') }),
            row({ id: 'c3', createdAt: new Date('2026-08-08T20:02:00.000Z') }),
        ];
        mocks.contributionFindMany.mockResolvedValue(rows);

        const page = await listPublicContributions({
            scheduledSessionId: 'session-1',
            cursor: null,
            limit: 2,
        });

        expect(page.contributions.map((c) => c.id)).toEqual(['c1', 'c2']);
        expect(page.nextCursor).not.toBeNull();
        expect(decodeContributionCursor(page.nextCursor)).toEqual({
            createdAt: '2026-08-08T20:01:00.000Z',
            id: 'c2',
        });
    });

    it('applies the cursor as a strict (createdAt, id) upper bound', async () => {
        mocks.contributionFindMany.mockResolvedValue([]);

        await listPublicContributions({
            scheduledSessionId: 'session-1',
            cursor: { createdAt: '2026-08-08T20:01:00.000Z', id: 'c2' },
            limit: 50,
        });

        expect(mocks.contributionFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    OR: [
                        { createdAt: { gt: new Date('2026-08-08T20:01:00.000Z') } },
                        { createdAt: new Date('2026-08-08T20:01:00.000Z'), id: { gt: 'c2' } },
                    ],
                }),
            }),
        );
    });
});

describe('listStaffContributions', () => {
    it('lists VISIBLE and HIDDEN with the author identity, never WITHDRAWN', async () => {
        mocks.contributionFindMany.mockResolvedValue([
            { ...row(), authorParticipant: { participantIdentity: 'lk-ticket-t1' } },
        ]);

        const page = await listStaffContributions({
            scheduledSessionId: 'session-1',
            cursor: null,
            limit: 50,
        });

        expect(mocks.contributionFindMany).toHaveBeenCalledWith({
            where: {
                scheduledSessionId: 'session-1',
                state: { in: ['VISIBLE', 'HIDDEN'] },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 51,
            include: { authorParticipant: { select: { participantIdentity: true } } },
        });
        expect(page.contributions[0].authorDisplayName).toBe('Ana');
        expect(page.contributions[0].participantIdentity).toBe('lk-ticket-t1');
    });
});
