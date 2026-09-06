import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma } from '@prisma/client';

import { createRequest } from '@/__tests__/helpers';

const findWebSession = vi.fn();
const findScheduledSession = vi.fn();
const findParticipant = vi.fn();
const updateParticipant = vi.fn();
const upsertParticipant = vi.fn();
const stableRoomIdentity = vi.fn(
    (eventId: string, kind: string, principalId: string) =>
        `opaque:${eventId}:${kind}:${principalId}`,
);

vi.mock('@/lib/db', () => ({
    prisma: {
        webSession: { findUnique: findWebSession },
        scheduledSession: { findUnique: findScheduledSession },
        sessionParticipant: {
            findFirst: findParticipant,
            update: updateParticipant,
            upsert: upsertParticipant,
        },
    },
}));
vi.mock('@/lib/livekit-server', () => ({ stableRoomIdentity }));

const now = new Date('2026-08-01T16:00:00Z');
const publicCycleSessionId = '50000000-0000-4000-8000-202608220001';
const activeEvent = {
    id: 'event-1',
    title: 'Weekend event',
    roomName: 'weekend-stage',
    status: 'LIVE',
    startedAt: new Date('2026-08-01T15:00:00Z'),
    facilitatorId: 'facilitator-1',
};
const activeTicketSession = {
    displayName: 'Ana',
    displayNameConfirmedAt: now,
    expiresAt: new Date('2026-08-03T00:00:00Z'),
    revokedAt: null,
    staffUser: null,
    ticketEntitlement: {
        id: 'ticket-1',
        scheduledSessionId: 'event-1',
        state: 'BOUND',
        boundEmail: 'private@example.com',
        expiresAt: new Date('2026-08-02T00:00:00Z'),
        revokedAt: null,
        commerceEntitlement: null,
    },
};

function request(withCookie = true) {
    return createRequest('/api/scheduled-sessions/event-1/token', {
        headers: withCookie ? { cookie: 'hb_session=opaque-cookie' } : {},
    });
}

function prismaError(code: string) {
    return new Prisma.PrismaClientKnownRequestError('room participant write failed', {
        code,
        clientVersion: 'test',
    });
}

describe('resolveRoomPrincipal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        findWebSession.mockResolvedValue(activeTicketSession);
        findScheduledSession.mockResolvedValue(activeEvent);
        findParticipant.mockResolvedValue(null);
        updateParticipant.mockResolvedValue({
            publishGrantedAt: null,
            publishRevokedAt: null,
        });
        upsertParticipant.mockResolvedValue({
            publishGrantedAt: null,
            publishRevokedAt: null,
        });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('rejects a legacy anonymous public-cycle ticket while Account is enabled', async () => {
        vi.stubEnv('BEACON_ACCOUNT_ENABLED', 'true');
        findWebSession.mockResolvedValue({
            ...activeTicketSession,
            displayName: 'Participante',
            accountIssuer: null,
            accountSubject: null,
            accountSessionId: null,
            accountDisplayName: null,
            accountEmail: null,
            accountEmailVerified: false,
            accountAuthMethod: null,
            accountValidatedAt: null,
            ticketEntitlement: {
                ...activeTicketSession.ticketEntitlement,
                scheduledSessionId: publicCycleSessionId,
                tier: 'COMP',
                codeLastFour: 'FREE',
                boundEmail: 'public-opaque@anonymous.harmonicbeacon.invalid',
                accountId: null,
                accountIssuer: null,
                scheduledSession: { publicAccess: true, isTest: false },
            },
        });
        findScheduledSession.mockResolvedValue({
            ...activeEvent,
            id: publicCycleSessionId,
        });

        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(
            request(),
            publicCycleSessionId,
            now,
        );

        expect(result).toEqual({
            ok: false,
            status: 401,
            error: 'Authentication required',
        });
    });

    it.each([
        ['google', true],
        ['email', false],
        ['apple', false],
    ] as const)('requires Google at the room boundary for public-cycle access: %s', async (
        accountAuthMethod,
        allowed,
    ) => {
        vi.stubEnv('BEACON_ACCOUNT_ENABLED', 'true');
        vi.stubEnv('BEACON_ACCOUNT_ISSUER_URL', 'https://account.harmonicbeacon.com');
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_ID', 'hb-live');
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET', 'test-secret-that-is-at-least-32-characters');
        findWebSession.mockResolvedValue({
            ...activeTicketSession,
            accountIssuer: 'https://account.harmonicbeacon.com',
            accountSubject: 'account-subject',
            accountSessionId: 'account-session',
            accountDisplayName: 'Ana',
            accountEmail: 'ana@example.com',
            accountEmailVerified: true,
            accountAuthMethod,
            accountValidatedAt: now,
            ticketEntitlement: {
                ...activeTicketSession.ticketEntitlement,
                scheduledSessionId: publicCycleSessionId,
                tier: 'COMP',
                codeLastFour: 'FREE',
                boundEmail: 'ana@example.com',
                accountId: 'account-subject',
                accountIssuer: 'https://account.harmonicbeacon.com',
                scheduledSession: { publicAccess: true, isTest: false },
            },
        });
        findScheduledSession.mockResolvedValue({ ...activeEvent, id: publicCycleSessionId });

        const result = await (await import('../room-entitlement')).resolveRoomPrincipal(
            request(),
            publicCycleSessionId,
            now,
        );

        expect(result.ok).toBe(allowed);
    });

    it('rejects a missing opaque cookie without touching the database', async () => {
        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(false), 'event-1', now);

        expect(result).toEqual({
            ok: false,
            status: 401,
            error: 'Authentication required',
        });
        expect(findWebSession).not.toHaveBeenCalled();
    });

    it('rejects a direct room or hand request until the attendee confirms the event alias', async () => {
        findWebSession.mockResolvedValue({
            ...activeTicketSession,
            displayNameConfirmedAt: null,
        });

        const { resolveRoomPrincipal } = await import('../room-entitlement');
        await expect(resolveRoomPrincipal(request(), 'event-1', now)).resolves.toEqual({
            ok: false,
            status: 403,
            error: 'Not authorized',
        });
        expect(findParticipant).not.toHaveBeenCalled();
        expect(upsertParticipant).not.toHaveBeenCalled();
        expect(updateParticipant).not.toHaveBeenCalled();
    });

    it.each([
        ['revoked web session', { revokedAt: now }],
        ['expired web session', { expiresAt: now }],
        ['revoked ticket', {
            ticketEntitlement: {
                ...activeTicketSession.ticketEntitlement,
                revokedAt: now,
            },
        }],
        ['wrong-event ticket', {
            ticketEntitlement: {
                ...activeTicketSession.ticketEntitlement,
                scheduledSessionId: 'event-2',
            },
        }],
        ['unbound ticket', {
            ticketEntitlement: {
                ...activeTicketSession.ticketEntitlement,
                state: 'ISSUED',
            },
        }],
    ])('rejects %s from a live paid event', async (_name, override) => {
        findWebSession.mockResolvedValue({
            ...activeTicketSession,
            ...override,
        });
        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result.ok).toBe(false);
        expect(upsertParticipant).not.toHaveBeenCalled();
    });

    it.each(['ENDED', 'CANCELLED', 'SCHEDULED'])(
        'does not admit an attendee to a %s event',
        async (status) => {
            findScheduledSession.mockResolvedValue({ ...activeEvent, status });
            const { resolveRoomPrincipal } = await import('../room-entitlement');
            const result = await resolveRoomPrincipal(request(), 'event-1', now);

            expect(result).toMatchObject({ ok: false, status: 403 });
        },
    );

    it('reuses the event identity and current durable grant on refresh', async () => {
        upsertParticipant.mockResolvedValue({
            publishGrantedAt: new Date('2026-08-01T15:30:00Z'),
            publishRevokedAt: null,
            grantReconcileNeeded: false,
        });
        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const first = await resolveRoomPrincipal(request(), 'event-1', now);
        const refresh = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(first).toEqual(refresh);
        expect(first).toMatchObject({
            ok: true,
            principal: {
                identity: 'opaque:event-1:ticket:ticket-1',
                canPublish: true,
                displayName: 'Ana',
                role: 'ATTENDEE',
                isAssignedFacilitator: false,
            },
        });
        expect(upsertParticipant).toHaveBeenCalledWith(expect.objectContaining({
            update: { leftAt: null },
        }));
    });

    it('mints subscriber-only access while the durable grant effect is pending', async () => {
        upsertParticipant.mockResolvedValue({
            publishGrantedAt: new Date('2026-08-01T15:30:00Z'),
            publishRevokedAt: null,
            grantReconcileNeeded: true,
        });
        const { resolveRoomPrincipal } = await import('../room-entitlement');

        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({
            ok: true,
            principal: { canPublish: false },
        });
    });

    it('lets a newly confirmed device correct the durable alias without changing identity', async () => {
        findWebSession.mockResolvedValue({
            ...activeTicketSession,
            displayName: 'Anahí 李',
            displayNameConfirmedAt: now,
        });
        findParticipant.mockResolvedValue({
            id: 'participant-1',
            displayName: 'Nombre anterior',
            publishGrantedAt: null,
            publishRevokedAt: null,
        });

        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({
            ok: true,
            principal: {
                identity: 'opaque:event-1:ticket:ticket-1',
                displayName: 'Anahí 李',
            },
        });
        expect(updateParticipant).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'participant-1' },
            data: expect.objectContaining({ displayName: 'Anahí 李' }),
        }));
    });

    it('recovers a concurrent ticket insert only from the exact canonical winner', async () => {
        findParticipant
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'ticket-race-winner' });
        upsertParticipant.mockRejectedValue(prismaError('P2002'));
        updateParticipant.mockResolvedValue({
            publishGrantedAt: now,
            publishRevokedAt: null,
        });

        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({
            ok: true,
            principal: {
                identity: 'opaque:event-1:ticket:ticket-1',
                canPublish: true,
            },
        });
        expect(findParticipant).toHaveBeenLastCalledWith({
            where: {
                scheduledSessionId: 'event-1',
                participantIdentity: 'opaque:event-1:ticket:ticket-1',
                ticketEntitlementId: 'ticket-1',
            },
            select: { id: true },
        });
        expect(updateParticipant).toHaveBeenCalledWith({
            where: { id: 'ticket-race-winner' },
            data: { leftAt: null, displayName: 'Ana' },
            select: {
                grantReconcileNeeded: true,
                publishGrantedAt: true,
                publishRevokedAt: true,
            },
        });
    });

    it('recovers the equivalent concurrent staff insert', async () => {
        findWebSession.mockResolvedValue({
            expiresAt: new Date('2026-08-03T00:00:00Z'),
            revokedAt: null,
            ticketEntitlement: null,
            staffUser: {
                id: 'facilitator-1',
                name: 'Julián',
                role: 'FACILITATOR',
                disabledAt: null,
            },
        });
        findParticipant
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'staff-race-winner' });
        upsertParticipant.mockRejectedValue(prismaError('P2002'));
        updateParticipant.mockResolvedValue({
            publishGrantedAt: now,
            publishRevokedAt: null,
        });

        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({
            ok: true,
            principal: {
                identity: 'opaque:event-1:staff:facilitator-1',
                canPublish: true,
            },
        });
        expect(findParticipant).toHaveBeenLastCalledWith({
            where: {
                scheduledSessionId: 'event-1',
                participantIdentity: 'opaque:event-1:staff:facilitator-1',
                staffUserId: 'facilitator-1',
            },
            select: { id: true },
        });
    });

    it('does not hide a unique conflict without the exact canonical principal', async () => {
        findParticipant
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null);
        const conflict = prismaError('P2002');
        upsertParticipant.mockRejectedValue(conflict);

        const { resolveRoomPrincipal } = await import('../room-entitlement');
        await expect(resolveRoomPrincipal(request(), 'event-1', now)).rejects.toBe(conflict);
        expect(updateParticipant).not.toHaveBeenCalled();
    });

    it('does not retry a non-unique participant write failure', async () => {
        const failure = prismaError('P2025');
        upsertParticipant.mockRejectedValue(failure);

        const { resolveRoomPrincipal } = await import('../room-entitlement');
        await expect(resolveRoomPrincipal(request(), 'event-1', now)).rejects.toBe(failure);
        expect(findParticipant).toHaveBeenCalledTimes(1);
        expect(updateParticipant).not.toHaveBeenCalled();
    });

    it('versions commerce identities so old-token cleanup cannot kick restored access', async () => {
        findWebSession.mockResolvedValue({
            ...activeTicketSession,
            ticketEntitlement: {
                ...activeTicketSession.ticketEntitlement,
                commerceEntitlement: { livekitIdentityVersion: 3 },
            },
        });
        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({
            ok: true,
            principal: { identity: 'opaque:event-1:ticket:ticket-1:v3' },
        });
    });

    it('preserves the durable seeded facilitator identity instead of inserting a duplicate', async () => {
        findWebSession.mockResolvedValue({
            expiresAt: new Date('2026-08-03T00:00:00Z'),
            revokedAt: null,
            ticketEntitlement: null,
            staffUser: {
                id: 'facilitator-1',
                name: 'Julián',
                role: 'FACILITATOR',
                disabledAt: null,
            },
        });
        findScheduledSession.mockResolvedValue({
            ...activeEvent,
            status: 'SCHEDULED',
        });
        findParticipant.mockResolvedValue({
            id: 'seeded-facilitator-row',
            participantIdentity: 'seeded-durable-identity',
        });
        updateParticipant.mockResolvedValue({
            publishGrantedAt: now,
            publishRevokedAt: null,
        });

        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({
            ok: true,
            principal: {
                identity: 'seeded-durable-identity',
                canPublish: true,
                isAssignedFacilitator: true,
            },
        });
        expect(updateParticipant).toHaveBeenCalledWith({
            where: { id: 'seeded-facilitator-row' },
            data: {
                displayName: 'Julián',
                leftAt: null,
            },
            select: {
                grantReconcileNeeded: true,
                publishGrantedAt: true,
                publishRevokedAt: true,
            },
        });
        expect(upsertParticipant).not.toHaveBeenCalled();
    });

    it('lets only the assigned facilitator preflight with an initial grant', async () => {
        upsertParticipant.mockResolvedValue({
            publishGrantedAt: now,
            publishRevokedAt: null,
        });
        findWebSession.mockResolvedValue({
            expiresAt: new Date('2026-08-03T00:00:00Z'),
            revokedAt: null,
            ticketEntitlement: null,
            staffUser: {
                id: 'facilitator-1',
                name: 'Julián',
                role: 'FACILITATOR',
                disabledAt: null,
            },
        });
        findScheduledSession.mockResolvedValue({
            ...activeEvent,
            status: 'SCHEDULED',
        });
        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({
            ok: true,
            principal: {
                canPublish: true,
                displayName: 'Julián',
                role: 'FACILITATOR',
                isAssignedFacilitator: true,
            },
        });
        expect(upsertParticipant).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({
                publishGrantedAt: now,
                staffUserId: 'facilitator-1',
            }),
        }));
    });

    it('keeps operators subscribe-only unless their durable grant is active', async () => {
        findWebSession.mockResolvedValue({
            expiresAt: new Date('2026-08-03T00:00:00Z'),
            revokedAt: null,
            ticketEntitlement: null,
            staffUser: {
                id: 'operator-1',
                name: 'Oliva',
                role: 'OPERATOR',
                disabledAt: null,
            },
        });
        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({
            ok: true,
            principal: {
                canPublish: false,
                displayName: 'Oliva',
                role: 'OPERATOR',
                isAssignedFacilitator: false,
            },
        });
    });

    it('rejects a facilitator assigned to another event', async () => {
        findWebSession.mockResolvedValue({
            expiresAt: new Date('2026-08-03T00:00:00Z'),
            revokedAt: null,
            ticketEntitlement: null,
            staffUser: {
                id: 'facilitator-2',
                name: 'Other facilitator',
                role: 'FACILITATOR',
                disabledAt: null,
            },
        });
        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({ ok: false, status: 403 });
        expect(upsertParticipant).not.toHaveBeenCalled();
    });

    it('treats FACILITATOR_OP as facilitator and grants initial publish only when assigned', async () => {
        upsertParticipant.mockResolvedValue({
            publishGrantedAt: now,
            publishRevokedAt: null,
        });
        findWebSession.mockResolvedValue({
            expiresAt: new Date('2026-08-03T00:00:00Z'),
            revokedAt: null,
            ticketEntitlement: null,
            staffUser: {
                id: 'facilitator-1',
                name: 'Julián',
                role: 'FACILITATOR_OP',
                disabledAt: null,
            },
        });

        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({
            ok: true,
            principal: {
                role: 'FACILITATOR_OP',
                canPublish: true,
                isAssignedFacilitator: true,
            },
        });
        expect(upsertParticipant).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({
                publishGrantedAt: now,
                grantReason: 'Facilitator preflight grant',
            }),
        }));
    });

    it('lets FACILITATOR_OP operate another event but never grants initial publish there', async () => {
        findWebSession.mockResolvedValue({
            expiresAt: new Date('2026-08-03T00:00:00Z'),
            revokedAt: null,
            ticketEntitlement: null,
            staffUser: {
                id: 'facilitator-op-2',
                name: 'Global conductor',
                role: 'FACILITATOR_OP',
                disabledAt: null,
            },
        });

        const { resolveRoomPrincipal } = await import('../room-entitlement');
        const result = await resolveRoomPrincipal(request(), 'event-1', now);

        expect(result).toMatchObject({
            ok: true,
            principal: {
                role: 'FACILITATOR_OP',
                canPublish: false,
                isAssignedFacilitator: false,
            },
        });
        expect(upsertParticipant).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({
                publishGrantedAt: null,
                grantVersion: 0,
                grantReason: null,
            }),
        }));
    });
});
