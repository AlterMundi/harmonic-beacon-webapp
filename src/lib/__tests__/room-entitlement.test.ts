import { beforeEach, describe, expect, it, vi } from 'vitest';

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

    it('migrates the seeded facilitator row to the stable identity instead of inserting a duplicate', async () => {
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
        findParticipant.mockResolvedValue({ id: 'seeded-facilitator-row' });
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
                isAssignedFacilitator: true,
            },
        });
        expect(updateParticipant).toHaveBeenCalledWith({
            where: { id: 'seeded-facilitator-row' },
            data: {
                participantIdentity: 'opaque:event-1:staff:facilitator-1',
                leftAt: null,
            },
            select: {
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
