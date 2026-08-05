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

    it('resolves a cross-process P2002 race by re-reading the canonical row', async () => {
        const winner = row({
            requestDigest: contributionRequestDigest('NAMED', '¿Cómo respiramos? Siento calma'),
        });
        mocks.contributionFindUnique
            .mockResolvedValueOnce(null) // fast path, outside the lock
            .mockResolvedValueOnce(null) // re-check inside the lock
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
        // The P2002 replay released the reservation: budget untouched.
        expect(contributionSubmissionLimiter.submissionCount('session-1:participant-1')).toBe(0);
    });

    it('rejects when the attendee has not joined the session', async () => {
        mocks.participantFindFirst.mockResolvedValue(null);

        await expect(createContribution(base)).rejects.toMatchObject({
            code: 'participant_not_joined',
            status: 409,
        });
        expect(mocks.contributionCreate).not.toHaveBeenCalled();
    });

    it('lets replays and conflicts through after the budget is exhausted, but not a sixth new key', async () => {
        mocks.contributionCreate.mockImplementation(async ({ data }) => row({
            id: `contrib-${data.idempotencyKey}`,
            idempotencyKey: data.idempotencyKey,
            body: data.body,
            requestDigest: data.requestDigest,
        }));

        // Five genuinely new keys: the whole window budget.
        for (let i = 0; i < 5; i += 1) {
            const result = await createContribution({
                ...base, idempotencyKey: `key-${i}`, body: `mensaje ${i}`,
            });
            expect(result.created).toBe(true);
        }
        expect(contributionSubmissionLimiter.submissionCount('session-1:participant-1')).toBe(5);

        // Replay of the fifth submission: canonical 200 semantics, not a 429.
        mocks.contributionFindUnique.mockResolvedValue(row({
            id: 'contrib-key-4',
            idempotencyKey: 'key-4',
            body: 'mensaje 4',
            requestDigest: contributionRequestDigest('NAMED', 'mensaje 4'),
        }));
        const replay = await createContribution({ ...base, idempotencyKey: 'key-4', body: 'mensaje 4' });
        expect(replay.created).toBe(false);
        expect(replay.contribution.id).toBe('contrib-key-4');

        // Same key with a different payload: 409, still not hidden behind a 429.
        await expect(
            createContribution({ ...base, idempotencyKey: 'key-4', body: 'otro mensaje' }),
        ).rejects.toMatchObject({ code: 'idempotency_key_conflict', status: 409 });

        // A sixth genuinely new key is the one that hits the limit.
        mocks.contributionFindUnique.mockResolvedValue(null);
        await expect(
            createContribution({ ...base, idempotencyKey: 'key-6', body: 'mensaje 6' }),
        ).rejects.toMatchObject({
            code: 'rate_limited',
            status: 429,
            details: { retryAfterSeconds: expect.any(Number) },
        });

        // Exactly five slots were ever consumed; the limited attempt never
        // reached the database.
        expect(contributionSubmissionLimiter.submissionCount('session-1:participant-1')).toBe(5);
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

    describe('concurrency — serialized per participant', () => {
        let store: Map<string, SessionContribution>;

        beforeEach(() => {
            // A minimal in-memory stand-in for the unique index: enough to
            // exercise fast path, in-lock re-check, and the P2002 fallback.
            store = new Map();
            mocks.contributionFindUnique.mockImplementation(async ({ where }) => {
                const key = where.scheduledSessionId_authorParticipantId_idempotencyKey;
                return store.get(
                    `${key.scheduledSessionId}:${key.authorParticipantId}:${key.idempotencyKey}`,
                ) ?? null;
            });
            mocks.contributionCreate.mockImplementation(async ({ data }) => {
                const storeKey = `${data.scheduledSessionId}:${data.authorParticipantId}:${data.idempotencyKey}`;
                if (store.has(storeKey)) {
                    const { Prisma } = await import('@prisma/client');
                    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                        code: 'P2002',
                        clientVersion: 'test',
                    });
                }
                const created = row({
                    id: `contrib-${data.idempotencyKey}`,
                    authorParticipantId: data.authorParticipantId,
                    body: data.body,
                    idempotencyKey: data.idempotencyKey,
                    requestDigest: data.requestDigest,
                });
                store.set(storeKey, created);
                return created;
            });
        });

        it('six concurrent new keys for one participant: exactly five created, one 429', async () => {
            const results = await Promise.allSettled(
                Array.from({ length: 6 }, (_, i) =>
                    createContribution({ ...base, idempotencyKey: `burst-${i}`, body: `mensaje ${i}` })),
            );

            const created = results.filter(
                (r) => r.status === 'fulfilled' && r.value.created,
            );
            const limited = results.filter(
                (r) => r.status === 'rejected' && (r.reason as ContributionError).code === 'rate_limited',
            );
            expect(created).toHaveLength(5);
            expect(limited).toHaveLength(1);
            const reason = (limited[0] as PromiseRejectedResult).reason as ContributionError;
            expect(reason.status).toBe(429);
            expect(reason.details?.retryAfterSeconds).toBeGreaterThan(0);
            expect(reason.details?.retryAfterSeconds).toBeLessThanOrEqual(60);
            expect(store.size).toBe(5);
            expect(contributionSubmissionLimiter.submissionCount('session-1:participant-1')).toBe(5);
        });

        it('six different participants never block each other or share budget', async () => {
            mocks.participantFindFirst.mockImplementation(async ({ where }) => ({
                id: `participant-${where.ticketEntitlementId}`,
            }));

            const results = await Promise.all(
                Array.from({ length: 6 }, (_, i) =>
                    createContribution({
                        ...base,
                        ticketEntitlementId: `ticket-${i}`,
                        idempotencyKey: `solo-${i}`,
                        body: `mensaje ${i}`,
                    })),
            );

            expect(results.every((r) => r.created)).toBe(true);
            expect(store.size).toBe(6);
        });

        it('concurrent submissions with the same key: one creation, the rest replay, one slot', async () => {
            const results = await Promise.all(
                Array.from({ length: 4 }, () => createContribution(base)),
            );

            expect(results.filter((r) => r.created)).toHaveLength(1);
            expect(new Set(results.map((r) => r.contribution.id)).size).toBe(1);
            expect(store.size).toBe(1);
            // Exactly one budget slot consumed across the whole burst.
            expect(contributionSubmissionLimiter.submissionCount('session-1:participant-1')).toBe(1);
        });

        it('a failed INSERT releases the reservation', async () => {
            mocks.contributionCreate.mockRejectedValueOnce(new Error('connection reset'));

            await expect(createContribution(base)).rejects.toThrowError('connection reset');
            expect(contributionSubmissionLimiter.submissionCount('session-1:participant-1')).toBe(0);

            // Budget intact: the retry goes through and consumes one slot.
            const retry = await createContribution(base);
            expect(retry.created).toBe(true);
            expect(contributionSubmissionLimiter.submissionCount('session-1:participant-1')).toBe(1);
        });
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
        expect(page.hasMore).toBe(false);
    });

    it('at the tail, resumeCursor marks the last item so polling can resume', async () => {
        mocks.contributionFindMany.mockResolvedValue([
            row({ id: 'c1', createdAt: new Date('2026-08-08T20:00:00.000Z') }),
            row({ id: 'c2', createdAt: new Date('2026-08-08T20:01:00.000Z') }),
        ]);

        const page = await listPublicContributions({
            scheduledSessionId: 'session-1',
            cursor: null,
            limit: 50,
        });

        expect(page.hasMore).toBe(false);
        expect(page.nextPageCursor).toBeNull();
        expect(page.resumeCursor).not.toBeNull();
        expect(decodeContributionCursor(page.resumeCursor)).toEqual({
            createdAt: '2026-08-08T20:01:00.000Z',
            id: 'c2',
        });
    });

    it('a truncated page exposes hasMore and nextPageCursor equal to resumeCursor', async () => {
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
        expect(page.hasMore).toBe(true);
        expect(page.nextPageCursor).toBe(page.resumeCursor);
        expect(decodeContributionCursor(page.nextPageCursor)).toEqual({
            createdAt: '2026-08-08T20:01:00.000Z',
            id: 'c2',
        });
    });

    it('an empty page (poll with nothing new) returns both cursors null', async () => {
        mocks.contributionFindMany.mockResolvedValue([]);

        const page = await listPublicContributions({
            scheduledSessionId: 'session-1',
            cursor: { createdAt: '2026-08-08T20:01:00.000Z', id: 'c2' },
            limit: 50,
        });

        expect(page.contributions).toEqual([]);
        expect(page.hasMore).toBe(false);
        expect(page.nextPageCursor).toBeNull();
        expect(page.resumeCursor).toBeNull();
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

    it('scopes every read to the requested session even with a foreign cursor', async () => {
        mocks.contributionFindMany.mockResolvedValue([]);

        // A cursor minted from session A's rows must never unlock session B's
        // feed: the session filter is always part of the where clause.
        await listPublicContributions({
            scheduledSessionId: 'session-b',
            cursor: { createdAt: '2026-08-08T20:01:00.000Z', id: 'a-row-id' },
            limit: 50,
        });

        expect(mocks.contributionFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ scheduledSessionId: 'session-b' }),
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

    it('shares the public feed pagination contract (tail resumeCursor)', async () => {
        mocks.contributionFindMany.mockResolvedValue([
            { ...row({ id: 's1' }), authorParticipant: { participantIdentity: 'lk-1' } },
        ]);

        const page = await listStaffContributions({
            scheduledSessionId: 'session-1',
            cursor: null,
            limit: 50,
        });

        expect(page.hasMore).toBe(false);
        expect(page.nextPageCursor).toBeNull();
        expect(decodeContributionCursor(page.resumeCursor)).toEqual({
            createdAt: '2026-08-08T20:00:00.000Z',
            id: 's1',
        });
    });
});
