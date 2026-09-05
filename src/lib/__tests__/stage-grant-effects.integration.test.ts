import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const live = vi.hoisted(() => ({
    rooms: new Map<string, Set<string>>(),
    permissions: [] as Array<{ identity: string; canPublish: boolean }>,
    permissionByIdentity: new Map<string, boolean>(),
    mutedTracks: [] as string[],
    holdPermission: null as Promise<void> | null,
    permissionFailures: 0,
}));

vi.mock('@/lib/livekit-server', () => ({
    bedRoomIdentity: (identity: string) => `bed-${identity}`,
    rotatedRoomIdentity: (_sessionId: string, _participantId: string, version: number) =>
        `rotated-${version}`,
    getRoomService: () => ({
        listParticipants: async (roomName: string) =>
            [...(live.rooms.get(roomName) ?? new Set())]
                .map((identity) => ({ identity })),
        updateParticipant: async (
            _roomName: string,
            identity: string,
            update: { permission: { canPublish: boolean } },
        ) => {
            if (live.holdPermission) await live.holdPermission;
            if (live.permissionFailures > 0) {
                live.permissionFailures -= 1;
                throw new Error('synthetic permission failure');
            }
            live.permissions.push({
                identity,
                canPublish: update.permission.canPublish,
            });
            live.permissionByIdentity.set(identity, update.permission.canPublish);
        },
        getParticipant: async () => ({
            tracks: [{ sid: 'TR_audio' }, { sid: 'TR_video' }],
        }),
        mutePublishedTrack: async (
            _roomName: string,
            _identity: string,
            trackSid: string,
        ) => {
            live.mutedTracks.push(trackSid);
        },
        removeParticipant: async (roomName: string, identity: string) => {
            live.rooms.get(roomName)?.delete(identity);
        },
    }),
}));

import { prisma } from '@/lib/db';
import {
    processNextStageGrantEffect,
    repairNextUncoveredGrantEffect,
    transitionParticipantGrant,
} from '@/lib/stage-grant-effects';
import {
    lockGrantParticipants,
    lockGrantSession,
    lockGrantTickets,
} from '@/lib/stage-grant-locks';
import { promoteParticipant } from '@/lib/stage-control';

const DATABASE_URL = process.env.E2E_DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;
const NOW = new Date('2026-09-05T06:00:00.000Z');

suite('stage grant outbox PostgreSQL contract', () => {
    let userId: string;
    let sessionId: string;
    let participantId: string;
    let participantIdentity: string;

    beforeEach(async () => {
        live.rooms.clear();
        live.permissions.length = 0;
        live.permissionByIdentity.clear();
        live.mutedTracks.length = 0;
        live.holdPermission = null;
        live.permissionFailures = 0;

        userId = randomUUID();
        sessionId = randomUUID();
        participantId = randomUUID();
        participantIdentity = `grant-test-${participantId}`;
        await prisma.user.create({
            data: {
                id: userId,
                email: `${userId}@invalid.example`,
                name: 'Synthetic facilitator',
                role: 'FACILITATOR',
                passwordDigest: 'not-a-real-password',
            },
        });
        await prisma.scheduledSession.create({
            data: {
                id: sessionId,
                title: 'Synthetic durable grant test',
                roomName: `grant-room-${sessionId}`,
                language: 'SPANISH',
                scheduledAt: NOW,
                status: 'LIVE',
                facilitatorId: userId,
            },
        });
        await prisma.sessionParticipant.create({
            data: {
                id: participantId,
                scheduledSessionId: sessionId,
                participantIdentity,
                staffUserId: userId,
            },
        });
        live.rooms.set(`grant-room-${sessionId}`, new Set([participantIdentity]));
        live.rooms.set('beacon', new Set([`bed-${participantIdentity}`]));
    });

    afterEach(async () => {
        await prisma.scheduledSession.delete({ where: { id: sessionId } });
        await prisma.user.delete({ where: { id: userId } });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('processes revisions in order and clears the marker only after the tail', async () => {
        await prisma.$transaction(async (tx) => {
            await transitionParticipantGrant(tx, {
                scheduledSessionId: sessionId,
                participantId,
                canPublish: true,
                now: NOW,
                actorUserId: userId,
                reason: 'Synthetic promotion',
            });
            await transitionParticipantGrant(tx, {
                scheduledSessionId: sessionId,
                participantId,
                canPublish: false,
                now: new Date(NOW.getTime() + 1),
                actorUserId: userId,
                reason: 'Synthetic demotion',
            });
        });

        await expect(processNextStageGrantEffect(
            new Date(NOW.getTime() + 2),
            participantId,
        )).resolves.toBe(true);
        expect(live.permissions.map((effect) => effect.canPublish)).toEqual([true]);
        await expect(prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        })).resolves.toMatchObject({ grantVersion: 2, grantReconcileNeeded: true });

        await expect(processNextStageGrantEffect(
            new Date(NOW.getTime() + 2),
            participantId,
        )).resolves.toBe(true);
        expect(live.permissions.map((effect) => effect.canPublish)).toEqual([true, false]);
        expect(live.mutedTracks).toEqual(['TR_audio', 'TR_video']);
        await expect(prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        })).resolves.toMatchObject({ grantVersion: 2, grantReconcileNeeded: false });
    });

    it('lets only one of two workers claim the participant head revision', async () => {
        await prisma.$transaction((tx) => transitionParticipantGrant(tx, {
            scheduledSessionId: sessionId,
            participantId,
            canPublish: true,
            now: NOW,
            actorUserId: userId,
            reason: 'Synthetic promotion',
        }));
        let release!: () => void;
        live.holdPermission = new Promise<void>((resolve) => { release = resolve; });

        const first = processNextStageGrantEffect(NOW, participantId);
        await vi.waitFor(async () => {
            const job = await prisma.stageGrantEffectOutbox.findFirstOrThrow({
                where: { participantId },
            });
            expect(job.status).toBe('PROCESSING');
        });
        const second = processNextStageGrantEffect(NOW, participantId);
        await expect(second).resolves.toBe(false);
        release();
        await expect(first).resolves.toBe(true);

        expect(live.permissions.map((effect) => effect.canPublish)).toEqual([true]);
        await expect(prisma.stageGrantEffectOutbox.findFirstOrThrow({
            where: { participantId },
        })).resolves.toMatchObject({ status: 'COMPLETED', attempts: 1 });
    });

    it('applies an older demotion before a newer promotion', async () => {
        await prisma.$transaction(async (tx) => {
            await transitionParticipantGrant(tx, {
                scheduledSessionId: sessionId,
                participantId,
                canPublish: false,
                now: NOW,
                actorUserId: userId,
                reason: 'Synthetic demotion',
            });
            await transitionParticipantGrant(tx, {
                scheduledSessionId: sessionId,
                participantId,
                canPublish: true,
                now: new Date(NOW.getTime() + 1),
                actorUserId: userId,
                reason: 'Synthetic promotion',
            });
        });

        await expect(processNextStageGrantEffect(
            new Date(NOW.getTime() + 2),
            participantId,
        )).resolves.toBe(true);
        expect(live.permissions.map((effect) => effect.canPublish)).toEqual([false]);
        await expect(prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        })).resolves.toMatchObject({ grantVersion: 2, grantReconcileNeeded: true });

        const rotated = await prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
            select: { participantIdentity: true },
        });
        live.rooms.get(`grant-room-${sessionId}`)?.add(rotated.participantIdentity);

        await expect(processNextStageGrantEffect(
            new Date(NOW.getTime() + 2),
            participantId,
        )).resolves.toBe(true);
        expect(live.permissions).toEqual([
            { identity: participantIdentity, canPublish: false },
            { identity: rotated.participantIdentity, canPublish: true },
        ]);
        const current = await prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        });
        expect(current).toMatchObject({ grantVersion: 2, grantReconcileNeeded: false });

        // Exact stale-N-after-N+1 boundary: even if an already-dispatched
        // legacy promotion lands after the newer revision, it can only mutate
        // the retired identity. The current identity and its permission are a
        // different remote epoch, and the retired identity is no longer in the
        // room.
        live.permissionByIdentity.set(participantIdentity, true);
        expect(current.participantIdentity).toBe(rotated.participantIdentity);
        expect(live.permissionByIdentity.get(current.participantIdentity)).toBe(true);
        expect(live.rooms.get(`grant-room-${sessionId}`)).not.toContain(participantIdentity);
    });

    it('retries an incomplete effect without clearing the marker', async () => {
        live.permissionFailures = 1;
        await prisma.$transaction((tx) => transitionParticipantGrant(tx, {
            scheduledSessionId: sessionId,
            participantId,
            canPublish: false,
            now: NOW,
            actorUserId: userId,
            reason: 'Synthetic demotion with transient failure',
        }));

        await expect(processNextStageGrantEffect(NOW, participantId)).resolves.toBe(true);
        await expect(prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        })).resolves.toMatchObject({ grantReconcileNeeded: true });
        await expect(prisma.stageGrantEffectOutbox.findFirstOrThrow({
            where: { participantId },
        })).resolves.toMatchObject({
            status: 'PENDING',
            attempts: 1,
            lastErrorCode: 'LIVEKIT_EFFECT_INCOMPLETE',
        });

        await expect(processNextStageGrantEffect(
            new Date(NOW.getTime() + 10_000),
            participantId,
        )).resolves.toBe(true);
        await expect(prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        })).resolves.toMatchObject({ grantReconcileNeeded: false });
        await expect(prisma.stageGrantEffectOutbox.findFirstOrThrow({
            where: { participantId },
        })).resolves.toMatchObject({ status: 'COMPLETED', attempts: 2 });
    });

    it('keeps removing reconnects until the last pre-revocation token expires', async () => {
        const horizon = new Date(NOW.getTime() + 30_000);
        await prisma.$transaction((tx) => transitionParticipantGrant(tx, {
            scheduledSessionId: sessionId,
            participantId,
            canPublish: false,
            now: NOW,
            actorUserId: userId,
            reason: 'Synthetic administrative revocation',
            disconnectParticipant: true,
            tokenHorizonAt: horizon,
        }));

        await expect(processNextStageGrantEffect(NOW, participantId)).resolves.toBe(true);
        expect(live.rooms.get(`grant-room-${sessionId}`)).toEqual(new Set());
        expect(live.rooms.get('beacon')).toEqual(new Set());
        await expect(prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        })).resolves.toMatchObject({ grantReconcileNeeded: false });
        await expect(prisma.stageGrantEffectOutbox.findFirstOrThrow({
            where: { participantId },
        })).resolves.toMatchObject({
            status: 'PENDING',
            grantAppliedAt: NOW,
            lastErrorCode: 'TOKEN_HORIZON_ACTIVE',
        });

        live.rooms.get(`grant-room-${sessionId}`)?.add(participantIdentity);
        live.rooms.get('beacon')?.add(`bed-${participantIdentity}`);
        await expect(processNextStageGrantEffect(
            new Date(horizon.getTime() + 1),
            participantId,
        )).resolves.toBe(true);

        expect(live.rooms.get(`grant-room-${sessionId}`)).toEqual(new Set());
        expect(live.rooms.get('beacon')).toEqual(new Set());
        await expect(prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        })).resolves.toMatchObject({ grantReconcileNeeded: false });
    });

    it('supersedes stale work before repairing a legacy rollback mutation on forward deploy', async () => {
        await prisma.$transaction((tx) => transitionParticipantGrant(tx, {
            scheduledSessionId: sessionId,
            participantId,
            canPublish: true,
            now: NOW,
            actorUserId: userId,
            reason: 'Pre-rollback promotion',
        }));
        // Exact shape of a legacy writer: it changes authority without moving
        // grantVersion, setting a marker or appending an outbox effect.
        await prisma.sessionParticipant.update({
            where: { id: participantId },
            data: {
                publishRevokedAt: new Date(NOW.getTime() + 1),
                grantReconcileNeeded: false,
            },
        });

        await expect(repairNextUncoveredGrantEffect(
            new Date(NOW.getTime() + 2),
        )).resolves.toBe(true);
        const repaired = await prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        });
        expect(repaired).toMatchObject({
            grantVersion: 2,
            grantReconcileNeeded: true,
            publishRevokedAt: new Date(NOW.getTime() + 2),
        });
        expect(repaired.participantIdentity).not.toBe(participantIdentity);

        const effects = await prisma.stageGrantEffectOutbox.findMany({
            where: { participantId },
            orderBy: { grantVersion: 'asc' },
        });
        expect(effects).toHaveLength(2);
        expect(effects[0]).toMatchObject({
            grantVersion: 1,
            canPublish: true,
            status: 'SUPERSEDED',
            lastErrorCode: 'SUPERSEDED_BY_FORWARD_REPAIR',
        });
        expect(effects[1]).toMatchObject({
            grantVersion: 2,
            participantIdentity,
            resultingParticipantIdentity: repaired.participantIdentity,
            canPublish: false,
            status: 'PENDING',
        });

        await expect(processNextStageGrantEffect(
            new Date(NOW.getTime() + 3),
            participantId,
        )).resolves.toBe(true);
        expect(live.rooms.get(`grant-room-${sessionId}`)).not.toContain(participantIdentity);
    });

    it('turns pre-outbox negative reconciliation debt into a rotated fresh revision', async () => {
        await prisma.sessionParticipant.update({
            where: { id: participantId },
            data: {
                publishRevokedAt: NOW,
                grantReconcileNeeded: true,
            },
        });

        await expect(repairNextUncoveredGrantEffect(
            new Date(NOW.getTime() + 1),
        )).resolves.toBe(true);
        const participant = await prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        });
        expect(participant).toMatchObject({ grantVersion: 1, grantReconcileNeeded: true });
        expect(participant.participantIdentity).not.toBe(participantIdentity);
        await expect(prisma.stageGrantEffectOutbox.findFirstOrThrow({
            where: { participantId },
        })).resolves.toMatchObject({
            grantVersion: 1,
            participantIdentity,
            resultingParticipantIdentity: participant.participantIdentity,
            canPublish: false,
            status: 'PENDING',
        });
    });

    it('does not reinterpret a reconciled first facilitator materialization as debt', async () => {
        await prisma.sessionParticipant.update({
            where: { id: participantId },
            data: {
                publishGrantedAt: NOW,
                grantVersion: 1,
                grantReconcileNeeded: false,
            },
        });

        await expect(repairNextUncoveredGrantEffect(
            new Date(NOW.getTime() + 1),
        )).resolves.toBe(false);
        await expect(prisma.stageGrantEffectOutbox.count({
            where: { participantId },
        })).resolves.toBe(0);
    });

    it('serializes promotion first, then revocation, into a final negative revision', async () => {
        const ticketId = randomUUID();
        await prisma.ticketEntitlement.create({
            data: {
                id: ticketId,
                scheduledSessionId: sessionId,
                codeDigest: `digest-${ticketId}`,
                codeLastFour: 'LOCK',
                tier: 'GLOBAL_SOUTH',
                state: 'BOUND',
                boundEmail: 'synthetic@invalid.example',
                boundAt: NOW,
                expiresAt: new Date(NOW.getTime() + 86_400_000),
            },
        });
        await prisma.sessionParticipant.update({
            where: { id: participantId },
            data: { staffUserId: null, ticketEntitlementId: ticketId },
        });

        let releasePromotion!: () => void;
        let promotionLocked!: () => void;
        const locked = new Promise<void>((resolve) => { promotionLocked = resolve; });
        const hold = new Promise<void>((resolve) => { releasePromotion = resolve; });
        const promotion = prisma.$transaction(async (tx) => {
            await lockGrantSession(tx, sessionId);
            await lockGrantTickets(tx, [ticketId]);
            await lockGrantParticipants(tx, [participantId]);
            const ticket = await tx.ticketEntitlement.findUniqueOrThrow({
                where: { id: ticketId },
            });
            expect(ticket.state).toBe('BOUND');
            await transitionParticipantGrant(tx, {
                scheduledSessionId: sessionId,
                participantId,
                canPublish: true,
                now: NOW,
                actorUserId: userId,
                reason: 'Promotion wins lock order',
            });
            promotionLocked();
            await hold;
        });
        await locked;

        const revocation = prisma.$transaction(async (tx) => {
            await lockGrantSession(tx, sessionId);
            await lockGrantTickets(tx, [ticketId]);
            await lockGrantParticipants(tx, [participantId]);
            await tx.ticketEntitlement.update({
                where: { id: ticketId },
                data: {
                    state: 'REVOKED',
                    revokedAt: new Date(NOW.getTime() + 1),
                    revokedByUserId: userId,
                    revocationReason: 'Synthetic concurrent revocation',
                },
            });
            await transitionParticipantGrant(tx, {
                scheduledSessionId: sessionId,
                participantId,
                canPublish: false,
                now: new Date(NOW.getTime() + 1),
                actorUserId: userId,
                reason: 'Revocation follows promotion',
            });
        });
        releasePromotion();
        await Promise.all([promotion, revocation]);

        await expect(prisma.ticketEntitlement.findUniqueOrThrow({
            where: { id: ticketId },
        })).resolves.toMatchObject({ state: 'REVOKED' });
        await expect(prisma.stageGrantEffectOutbox.findMany({
            where: { participantId },
            orderBy: { grantVersion: 'asc' },
            select: { grantVersion: true, canPublish: true },
        })).resolves.toEqual([
            { grantVersion: 1, canPublish: true },
            { grantVersion: 2, canPublish: false },
        ]);
    });

    it('makes a promotion waiting behind revocation reread the revoked entitlement', async () => {
        const ticketId = randomUUID();
        await prisma.ticketEntitlement.create({
            data: {
                id: ticketId,
                scheduledSessionId: sessionId,
                codeDigest: `digest-${ticketId}`,
                codeLastFour: 'LOCK',
                tier: 'GLOBAL_SOUTH',
                state: 'BOUND',
                boundEmail: 'synthetic@invalid.example',
                boundAt: NOW,
                expiresAt: new Date(NOW.getTime() + 86_400_000),
            },
        });
        await prisma.sessionParticipant.update({
            where: { id: participantId },
            data: { staffUserId: null, ticketEntitlementId: ticketId },
        });

        let releaseRevocation!: () => void;
        let revocationLocked!: () => void;
        const locked = new Promise<void>((resolve) => { revocationLocked = resolve; });
        const hold = new Promise<void>((resolve) => { releaseRevocation = resolve; });
        const revocation = prisma.$transaction(async (tx) => {
            await lockGrantSession(tx, sessionId);
            await lockGrantTickets(tx, [ticketId]);
            await lockGrantParticipants(tx, [participantId]);
            revocationLocked();
            await hold;
            await tx.ticketEntitlement.update({
                where: { id: ticketId },
                data: {
                    state: 'REVOKED',
                    revokedAt: NOW,
                    revokedByUserId: userId,
                    revocationReason: 'Synthetic concurrent revocation',
                },
            });
            await transitionParticipantGrant(tx, {
                scheduledSessionId: sessionId,
                participantId,
                canPublish: false,
                now: NOW,
                actorUserId: userId,
                reason: 'Revocation wins lock order',
            });
        });
        await locked;

        const promotion = promoteParticipant({
            scheduledSessionId: sessionId,
            participantId,
            actorUserId: userId,
            reason: 'Must reread after waiting',
            now: new Date(NOW.getTime() + 1),
        });
        releaseRevocation();
        await revocation;
        await expect(promotion).rejects.toMatchObject({ code: 'entitlement_inactive' });
        await expect(prisma.stageGrantEffectOutbox.findMany({
            where: { participantId },
            select: { grantVersion: true, canPublish: true },
        })).resolves.toEqual([{ grantVersion: 1, canPublish: false }]);
    });
});
