import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackSource } from 'livekit-server-sdk';

const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),
    sessionFindUnique: vi.fn(),
    participantFindMany: vi.fn(),
    participantFindFirst: vi.fn(),
    participantUpdate: vi.fn(),
    participantUpdateMany: vi.fn(),
    auditCreate: vi.fn(),
    queryRaw: vi.fn(),
    updateParticipant: vi.fn(),
    getParticipant: vi.fn(),
    mutePublishedTrack: vi.fn(),
    listParticipants: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        $transaction: mocks.transaction,
        scheduledSession: { findUnique: mocks.sessionFindUnique },
        sessionParticipant: {
            findFirst: mocks.participantFindFirst,
            update: mocks.participantUpdate,
            updateMany: mocks.participantUpdateMany,
        },
        auditLog: { create: mocks.auditCreate },
    },
}));

vi.mock('@/lib/livekit-server', () => ({
    getRoomService: () => ({
        updateParticipant: mocks.updateParticipant,
        getParticipant: mocks.getParticipant,
        mutePublishedTrack: mocks.mutePublishedTrack,
        listParticipants: mocks.listParticipants,
    }),
}));

type Participant = {
    id: string;
    participantIdentity: string;
    staffUserId: string | null;
    raisedAt: Date | null;
    publishGrantedAt: Date | null;
    publishRevokedAt: Date | null;
    grantReconcileNeeded: boolean;
    grantVersion: number;
};

const event = {
    id: 'event-1',
    roomName: 'weekend-stage',
    maxPublishers: 6,
    facilitatorId: 'julian',
};

let participants: Participant[];
let transactionTail: Promise<unknown>;

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function attendee(
    id: string,
    active = false,
    raisedAt: Date | null = null,
): Participant {
    return {
        id,
        participantIdentity: `opaque-${id}`,
        staffUserId: null,
        raisedAt,
        publishGrantedAt: active ? new Date('2026-08-01T15:00:00Z') : null,
        publishRevokedAt: null,
        grantReconcileNeeded: false,
        grantVersion: active ? 1 : 0,
    };
}

function applyUpdate(id: string, data: Record<string, unknown>) {
    const participant = participants.find((item) => item.id === id);
    if (!participant) {
        throw new Error(`unknown participant ${id}`);
    }
    for (const field of [
        'publishGrantedAt',
        'publishRevokedAt',
        'grantReconcileNeeded',
        'raisedAt',
    ] as const) {
        if (field in data) {
            participant[field] = data[field] as never;
        }
    }
    if (
        typeof data.grantVersion === 'object' &&
        data.grantVersion !== null &&
        'increment' in data.grantVersion
    ) {
        participant.grantVersion += Number(
            (data.grantVersion as { increment: number }).increment,
        );
    }
    return {
        id: participant.id,
        participantIdentity: participant.participantIdentity,
        grantVersion: participant.grantVersion,
    };
}

describe('stage control', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        participants = [];
        transactionTail = Promise.resolve();

        const transactionClient = {
            $queryRaw: mocks.queryRaw,
            scheduledSession: { findUnique: mocks.sessionFindUnique },
            sessionParticipant: {
                findMany: mocks.participantFindMany,
                findFirst: mocks.participantFindFirst,
                update: mocks.participantUpdate,
                updateMany: mocks.participantUpdateMany,
            },
            auditLog: { create: mocks.auditCreate },
        };
        mocks.transaction.mockImplementation(
            <T>(callback: (client: typeof transactionClient) => Promise<T>) => {
                const run = transactionTail.then(() => callback(transactionClient));
                transactionTail = run.catch(() => undefined);
                return run;
            },
        );
        mocks.queryRaw.mockResolvedValue([{ id: event.id }]);
        mocks.sessionFindUnique.mockImplementation(
            ({ select }: { select?: Record<string, unknown> }) => {
                if (select?.participants) {
                    return {
                        roomName: event.roomName,
                        participants: participants.map((participant) => ({
                            id: participant.id,
                            participantIdentity: participant.participantIdentity,
                            grantVersion: participant.grantVersion,
                        })),
                    };
                }
                return event;
            },
        );
        mocks.participantFindMany.mockImplementation(() => participants);
        mocks.participantFindFirst.mockImplementation(
            ({ where }: { where: { id?: string; participantIdentity?: string } }) =>
                (() => {
                    const participant = participants.find(
                        (item) => where.id
                            ? item.id === where.id
                            : item.participantIdentity === where.participantIdentity,
                    );
                    return participant
                        ? {
                            ...participant,
                            scheduledSession: { roomName: event.roomName },
                        }
                        : null;
                })(),
        );
        mocks.participantUpdate.mockImplementation(
            ({ where, data }: {
                where: { id: string };
                data: Record<string, unknown>;
            }) => applyUpdate(where.id, data),
        );
        mocks.participantUpdateMany.mockImplementation(
            ({ where, data }: {
                where: { id: string; grantVersion?: number };
                data: Record<string, unknown>;
            }) => {
                const participant = participants.find((item) => item.id === where.id);
                if (!participant || (
                    where.grantVersion !== undefined &&
                    participant.grantVersion !== where.grantVersion
                )) {
                    return { count: 0 };
                }
                applyUpdate(where.id, data);
                return { count: 1 };
            },
        );
        mocks.auditCreate.mockResolvedValue({});
        mocks.updateParticipant.mockResolvedValue({});
        mocks.getParticipant.mockResolvedValue({
            tracks: [{ sid: 'TR_audio' }, { sid: 'TR_video' }],
        });
        mocks.mutePublishedTrack.mockResolvedValue({});
        mocks.listParticipants.mockImplementation(() =>
            participants.map((participant) => ({
                identity: participant.participantIdentity,
            })),
        );
    });

    it('promotes with only microphone and camera publication permission', async () => {
        participants = [attendee('target')];
        const { promoteParticipant } = await import('../stage-control');

        const result = await promoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
        });

        expect(result).toMatchObject({
            participantId: 'target',
            canPublish: true,
            reconcileNeeded: false,
        });
        expect(mocks.updateParticipant).toHaveBeenCalledWith(
            event.roomName,
            'opaque-target',
            {
                permission: {
                    canPublish: true,
                    canPublishData: false,
                    canSubscribe: true,
                    canPublishSources: [
                        TrackSource.MICROPHONE,
                        TrackSource.CAMERA,
                    ],
                },
            },
        );
        expect(participants[0].publishGrantedAt).not.toBeNull();
        expect(participants[0].publishRevokedAt).toBeNull();
    });

    it('rejects a disconnected participant without changing durable grant state', async () => {
        participants = [attendee('target')];
        mocks.listParticipants.mockResolvedValue([]);
        const { promoteParticipant } = await import('../stage-control');

        await expect(promoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
        })).rejects.toMatchObject({
            code: 'participant_not_connected',
            status: 409,
        });

        expect(participants[0]).toMatchObject({
            publishGrantedAt: null,
            publishRevokedAt: null,
            grantReconcileNeeded: false,
            grantVersion: 0,
        });
        expect(mocks.updateParticipant).not.toHaveBeenCalled();
    });

    it('serializes concurrent promotions across slots five, six, and seven', async () => {
        participants = [
            attendee('active-1', true),
            attendee('active-2', true),
            attendee('active-3', true),
            attendee('first', false, new Date('2026-08-01T15:10:00Z')),
            attendee('second', false, new Date('2026-08-01T15:11:00Z')),
            attendee('third', false, new Date('2026-08-01T15:12:00Z')),
        ];
        const { promoteParticipant, StageControlError } =
            await import('../stage-control');

        const results = await Promise.allSettled([
            promoteParticipant({
                scheduledSessionId: event.id,
                participantId: 'first',
                actorUserId: 'operator-1',
            }),
            promoteParticipant({
                scheduledSessionId: event.id,
                participantId: 'second',
                actorUserId: 'operator-1',
            }),
            promoteParticipant({
                scheduledSessionId: event.id,
                participantId: 'third',
                actorUserId: 'operator-1',
            }),
        ]);

        expect(results[0].status).toBe('fulfilled');
        expect(results[1].status).toBe('fulfilled');
        expect(results[2].status).toBe('rejected');
        const rejection = (results[2] as PromiseRejectedResult).reason;
        expect(rejection).toBeInstanceOf(StageControlError);
        expect(rejection).toMatchObject({
            code: 'stage_full',
            status: 409,
            details: { queuePosition: 1 },
        });
        expect(
            participants.filter((participant) =>
                participant.publishGrantedAt && !participant.publishRevokedAt)
                .length,
        ).toBe(5);
        expect(mocks.updateParticipant).toHaveBeenCalledTimes(2);
    });

    it('revokes the durable grant and compensates after LiveKit promotion fails', async () => {
        participants = [attendee('target')];
        mocks.updateParticipant
            .mockRejectedValueOnce(new Error('LiveKit unavailable'))
            .mockResolvedValueOnce({});
        const { promoteParticipant } = await import('../stage-control');

        await expect(promoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
        })).rejects.toMatchObject({
            code: 'livekit_failed',
            status: 502,
            details: { reconcileNeeded: false },
        });

        expect(participants[0]).toMatchObject({
            grantReconcileNeeded: false,
        });
        expect(participants[0].publishRevokedAt).not.toBeNull();
        expect(mocks.updateParticipant).toHaveBeenLastCalledWith(
            event.roomName,
            'opaque-target',
            expect.objectContaining({
                permission: expect.objectContaining({ canPublish: false }),
            }),
        );
        expect(mocks.mutePublishedTrack).toHaveBeenCalledTimes(2);
    });

    it('reapplies a newer demotion after an older promotion effect finishes last', async () => {
        participants = [attendee('target')];
        const oldEffect = deferred();
        const applied: boolean[] = [];
        mocks.updateParticipant
            .mockImplementationOnce(async (
                _room: string,
                _identity: string,
                update: { permission: { canPublish: boolean } },
            ) => {
                await oldEffect.promise;
                applied.push(update.permission.canPublish);
            })
            .mockImplementation(async (
                _room: string,
                _identity: string,
                update: { permission: { canPublish: boolean } },
            ) => {
                applied.push(update.permission.canPublish);
            });
        const { demoteParticipant, promoteParticipant } = await import('../stage-control');

        const promotion = promoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
        });
        await vi.waitFor(() => expect(mocks.updateParticipant).toHaveBeenCalledTimes(1));
        expect(participants[0]).toMatchObject({
            grantVersion: 1,
            grantReconcileNeeded: true,
        });

        const demotion = await demoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
        });
        expect(demotion).toMatchObject({ canPublish: false, grantVersion: 2 });
        expect(applied).toEqual([false]);

        oldEffect.resolve();
        const stalePromotion = await promotion;

        expect(stalePromotion).toMatchObject({ canPublish: false, grantVersion: 2 });
        expect(applied).toEqual([false, true, false]);
        expect(participants[0]).toMatchObject({
            publishRevokedAt: expect.any(Date),
            grantReconcileNeeded: false,
            grantVersion: 2,
        });
    });

    it('reapplies a newer promotion after an older demotion effect finishes last', async () => {
        participants = [attendee('target', true)];
        const oldEffect = deferred();
        const applied: boolean[] = [];
        mocks.updateParticipant
            .mockImplementationOnce(async (
                _room: string,
                _identity: string,
                update: { permission: { canPublish: boolean } },
            ) => {
                await oldEffect.promise;
                applied.push(update.permission.canPublish);
            })
            .mockImplementation(async (
                _room: string,
                _identity: string,
                update: { permission: { canPublish: boolean } },
            ) => {
                applied.push(update.permission.canPublish);
            });
        const { demoteParticipant, promoteParticipant } = await import('../stage-control');

        const demotion = demoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
        });
        await vi.waitFor(() => expect(mocks.updateParticipant).toHaveBeenCalledTimes(1));
        expect(participants[0]).toMatchObject({
            grantVersion: 2,
            grantReconcileNeeded: true,
        });

        const promotion = await promoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
        });
        expect(promotion).toMatchObject({ canPublish: true, grantVersion: 3 });
        expect(applied).toEqual([true]);

        oldEffect.resolve();
        const staleDemotion = await demotion;

        expect(staleDemotion).toMatchObject({ canPublish: true, grantVersion: 3 });
        expect(applied).toEqual([true, false, true]);
        expect(participants[0]).toMatchObject({
            publishRevokedAt: null,
            grantReconcileNeeded: false,
            grantVersion: 3,
        });
    });

    it('does not let an obsolete promotion failure compensate a newer promotion', async () => {
        participants = [attendee('target')];
        const oldEffect = deferred();
        mocks.updateParticipant
            .mockImplementationOnce(async () => oldEffect.promise)
            .mockResolvedValue({});
        const { promoteParticipant } = await import('../stage-control');

        const oldPromotion = promoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
        });
        await vi.waitFor(() => expect(mocks.updateParticipant).toHaveBeenCalledTimes(1));

        const currentPromotion = await promoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-2',
        });
        expect(currentPromotion).toMatchObject({ canPublish: true, grantVersion: 2 });

        oldEffect.reject(new Error('obsolete LiveKit failure'));
        const stalePromotion = await oldPromotion;

        expect(stalePromotion).toMatchObject({ canPublish: true, grantVersion: 2 });
        expect(participants[0]).toMatchObject({
            publishRevokedAt: null,
            grantReconcileNeeded: false,
            grantVersion: 2,
        });
        expect(mocks.auditCreate).not.toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'stage.promote.livekit_failed' }),
        });
    });

    it('demotes before revoking LiveKit permission and force-mutes every track', async () => {
        participants = [attendee('target', true)];
        const { demoteParticipant } = await import('../stage-control');

        const result = await demoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
        });

        expect(result.canPublish).toBe(false);
        expect(participants[0].publishRevokedAt).not.toBeNull();
        expect(mocks.updateParticipant).toHaveBeenCalledWith(
            event.roomName,
            'opaque-target',
            expect.objectContaining({
                permission: expect.objectContaining({ canPublish: false }),
            }),
        );
        expect(mocks.mutePublishedTrack).toHaveBeenCalledWith(
            event.roomName,
            'opaque-target',
            'TR_audio',
            true,
        );
        expect(mocks.mutePublishedTrack).toHaveBeenCalledWith(
            event.roomName,
            'opaque-target',
            'TR_video',
            true,
        );
    });

    it('lets a ticket-backed attendee decline their own invitation and audits without a staff actor', async () => {
        participants = [attendee('target', true, new Date('2026-08-01T15:10:00Z'))];
        const { declineStageInvitation } = await import('../stage-control');

        const result = await declineStageInvitation({
            scheduledSessionId: event.id,
            participantIdentity: 'opaque-target',
        });

        expect(result).toMatchObject({ canPublish: false, reconcileNeeded: false });
        expect(participants[0].publishRevokedAt).not.toBeNull();
        expect(participants[0].raisedAt).toBeNull();
        expect(mocks.auditCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                actorUserId: null,
                action: 'stage.invitation.decline',
                targetId: 'target',
            }),
        });
        expect(mocks.updateParticipant).toHaveBeenCalledWith(
            event.roomName,
            'opaque-target',
            expect.objectContaining({
                permission: expect.objectContaining({ canPublish: false }),
            }),
        );
    });

    it('lets a ticket-backed attendee leave the stage, clears their hand, and audits the voluntary action', async () => {
        participants = [attendee('target', true, new Date('2026-08-01T15:10:00Z'))];
        const { leaveStage } = await import('../stage-control');

        const result = await leaveStage({
            scheduledSessionId: event.id,
            participantIdentity: 'opaque-target',
        });

        expect(result).toMatchObject({ canPublish: false, reconcileNeeded: false });
        expect(participants[0]).toMatchObject({
            raisedAt: null,
            grantVersion: 2,
        });
        expect(participants[0].publishRevokedAt).not.toBeNull();
        expect(mocks.auditCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                actorUserId: null,
                action: 'stage.attendee.leave',
                targetId: 'target',
            }),
        });
    });

    it('makes repeated voluntary exits idempotent, including a double click race', async () => {
        participants = [attendee('target', true, new Date('2026-08-01T15:10:00Z'))];
        const { leaveStage } = await import('../stage-control');

        const [first, second] = await Promise.all([
            leaveStage({
                scheduledSessionId: event.id,
                participantIdentity: 'opaque-target',
            }),
            leaveStage({
                scheduledSessionId: event.id,
                participantIdentity: 'opaque-target',
            }),
        ]);

        expect(first.grantVersion).toBe(2);
        expect(second.grantVersion).toBe(2);
        expect(participants[0]).toMatchObject({
            raisedAt: null,
            grantVersion: 2,
        });
        expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
        expect(mocks.updateParticipant).toHaveBeenCalledTimes(2);
    });

    it('converges a simultaneous voluntary exit and staff demotion on one revoked grant', async () => {
        participants = [attendee('target', true, new Date('2026-08-01T15:10:00Z'))];
        const { demoteParticipant, leaveStage } = await import('../stage-control');

        const results = await Promise.all([
            leaveStage({
                scheduledSessionId: event.id,
                participantIdentity: 'opaque-target',
            }),
            demoteParticipant({
                scheduledSessionId: event.id,
                participantId: 'target',
                actorUserId: 'operator-1',
                clearHand: true,
            }),
        ]);

        expect(results).toEqual([
            expect.objectContaining({ canPublish: false, grantVersion: 2 }),
            expect.objectContaining({ canPublish: false, grantVersion: 2 }),
        ]);
        expect(participants[0]).toMatchObject({
            raisedAt: null,
            grantVersion: 2,
        });
        expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    });

    it('refuses to demote the assigned facilitator reserved by the weekend contract', async () => {
        participants = [{
            ...attendee('facilitator', true),
            staffUserId: event.facilitatorId,
        }];
        const { demoteParticipant } = await import('../stage-control');

        await expect(demoteParticipant({
            scheduledSessionId: event.id,
            participantId: 'facilitator',
            actorUserId: 'operator-1',
        })).rejects.toMatchObject({
            code: 'facilitator_required',
            status: 409,
        });
        expect(mocks.updateParticipant).not.toHaveBeenCalled();
        expect(mocks.mutePublishedTrack).not.toHaveBeenCalled();
    });

    it('mutes a current publisher track', async () => {
        participants = [attendee('target', true)];
        const { muteParticipantTrack } = await import('../stage-control');

        await muteParticipantTrack({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
            trackSid: 'TR_audio',
            muted: true,
        });
        expect(mocks.mutePublishedTrack).toHaveBeenCalledWith(
            event.roomName,
            'opaque-target',
            'TR_audio',
            true,
        );
    });

    it('requires the participant to re-enable muted media', async () => {
        participants = [attendee('target', true)];
        const { muteParticipantTrack } = await import('../stage-control');

        await expect(muteParticipantTrack({
            scheduledSessionId: event.id,
            participantId: 'target',
            actorUserId: 'operator-1',
            trackSid: 'TR_video',
            muted: false,
        })).rejects.toMatchObject({
            code: 'invalid_request',
            status: 400,
        });
        expect(mocks.mutePublishedTrack).not.toHaveBeenCalled();
    });

    it('reconciles durable grants into LiveKit and clears successful flags', async () => {
        participants = [
            { ...attendee('publisher', true), grantReconcileNeeded: true },
            {
                ...attendee('subscriber'),
                publishRevokedAt: new Date('2026-08-01T15:30:00Z'),
                grantReconcileNeeded: true,
            },
        ];
        const { reconcileParticipants } = await import('../stage-control');

        const result = await reconcileParticipants({
            scheduledSessionId: event.id,
            actorUserId: 'operator-1',
        });

        expect(result).toEqual({
            reconciled: ['publisher', 'subscriber'],
            failed: [],
        });
        expect(mocks.updateParticipant).toHaveBeenCalledTimes(2);
        expect(mocks.mutePublishedTrack).toHaveBeenCalledTimes(2);
        expect(participants.every(
            (participant) => !participant.grantReconcileNeeded,
        )).toBe(true);
    });
});
