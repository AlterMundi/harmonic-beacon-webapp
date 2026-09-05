import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const live = vi.hoisted(() => ({
    rooms: new Map<string, Set<string>>(),
    permissions: [] as Array<{ identity: string; canPublish: boolean }>,
    mutedTracks: [] as string[],
    holdPermission: null as Promise<void> | null,
    permissionFailures: 0,
}));

vi.mock('@/lib/livekit-server', () => ({
    bedRoomIdentity: (identity: string) => `bed-${identity}`,
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
    transitionParticipantGrant,
} from '@/lib/stage-grant-effects';

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

        await expect(processNextStageGrantEffect(
            new Date(NOW.getTime() + 2),
            participantId,
        )).resolves.toBe(true);
        expect(live.permissions.map((effect) => effect.canPublish)).toEqual([false, true]);
        await expect(prisma.sessionParticipant.findUniqueOrThrow({
            where: { id: participantId },
        })).resolves.toMatchObject({ grantVersion: 2, grantReconcileNeeded: false });
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
        })).resolves.toMatchObject({ grantReconcileNeeded: true });

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
});
