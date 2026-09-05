import { NextResponse } from 'next/server';
import { TrackSource } from 'livekit-server-sdk';

import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getRoomService } from '@/lib/livekit-server';
import { effectiveStageState } from '@/lib/stage-presence';
import { eventStaffPolicy } from '@/lib/staff-capabilities';
import { tapestryInternalUrl, tapestryParticipantId } from '@/lib/tapestry';

export const dynamic = 'force-dynamic';

const DEFAULT_TAPESTRY_FRAME_TTL_MS = 10_000;
const THUMBNAIL_REFRESH_MS = 5_000;
const TAPESTRY_LOOKUP_TIMEOUT_MS = 750;
const MAX_TAPESTRY_PARTICIPANTS = 150;

type TapestrySnapshot = {
    available: boolean;
    participantIds: Set<string>;
    frameTtlMs: number;
};

async function currentTapestrySnapshot(sessionId: string): Promise<TapestrySnapshot> {
    const internalUrl = tapestryInternalUrl();
    if (!internalUrl || !process.env.TAPESTRY_INTERNAL_SECRET) {
        return {
            available: false,
            participantIds: new Set(),
            frameTtlMs: DEFAULT_TAPESTRY_FRAME_TTL_MS,
        };
    }
    try {
        const response = await fetch(
            `${internalUrl}/tapestry/sessions/${encodeURIComponent(sessionId)}/participants`,
            {
                headers: {
                    'x-tapestry-internal-secret': process.env.TAPESTRY_INTERNAL_SECRET,
                },
                cache: 'no-store',
                signal: AbortSignal.timeout(TAPESTRY_LOOKUP_TIMEOUT_MS),
            },
        );
        if (!response.ok) throw new Error('Tapestry list unavailable');
        const body = await response.json() as { participants?: unknown; frameTtlMs?: unknown };
        if (!Array.isArray(body.participants) || body.participants.length > MAX_TAPESTRY_PARTICIPANTS) {
            throw new Error('Invalid tapestry participant list');
        }
        const participantIds = body.participants.filter(
            (value): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value),
        );
        if (participantIds.length !== body.participants.length) {
            throw new Error('Invalid tapestry participant id');
        }
        const frameTtlMs = typeof body.frameTtlMs === 'number' &&
            Number.isFinite(body.frameTtlMs) &&
            body.frameTtlMs >= 1_000 &&
            body.frameTtlMs <= 60_000
            ? body.frameTtlMs
            : DEFAULT_TAPESTRY_FRAME_TTL_MS;
        return { available: true, participantIds: new Set(participantIds), frameTtlMs };
    } catch {
        // Thumbnail presence is advisory. LiveKit state, durable grants and
        // every stage action remain available if tapestry is slow or offline.
        return {
            available: false,
            participantIds: new Set(),
            frameTtlMs: DEFAULT_TAPESTRY_FRAME_TTL_MS,
        };
    }
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const [staff, errorResponse] = await requireStaff();
    if (!staff) {
        return errorResponse;
    }

    const { id } = await params;
    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        select: {
            id: true,
            roomName: true,
            status: true,
            facilitatorId: true,
            maxPublishers: true,
            participants: {
                orderBy: [
                    { raisedAt: 'asc' },
                    { joinedAt: 'asc' },
                ],
                select: {
                    id: true,
                    participantIdentity: true,
                    displayName: true,
                    joinedAt: true,
                    leftAt: true,
                    raisedAt: true,
                    publishGrantedAt: true,
                    publishRevokedAt: true,
                    grantVersion: true,
                    grantReconcileNeeded: true,
                    staffUser: {
                        select: {
                            id: true,
                            name: true,
                            role: true,
                        },
                    },
                },
            },
        },
    });
    if (!scheduledSession) {
        return NextResponse.json(
            { error: 'session_not_found' },
            { status: 404 },
        );
    }
    if (!eventStaffPolicy(
        staff.role,
        scheduledSession.facilitatorId === staff.userId,
    ).canOperateEvent) {
        return NextResponse.json(
            { error: 'Insufficient permissions' },
            { status: 403 },
        );
    }

    const tapestrySnapshotPromise = currentTapestrySnapshot(scheduledSession.id);
    let liveStateAvailable = true;
    let liveParticipants = new Map<string, {
        name: string;
        media: Array<{ trackSid: string; source: string; muted: boolean }>;
    }>();
    try {
        liveParticipants = new Map(
            (await getRoomService().listParticipants(scheduledSession.roomName))
                .map((participant) => [
                    participant.identity,
                    {
                        name: participant.name,
                        media: participant.tracks.map((track) => ({
                            trackSid: track.sid,
                            source: trackSourceLabel(track.source),
                            muted: track.muted,
                        })),
                    },
                ]),
        );
    } catch {
        // Durable grants and the queue remain usable during a LiveKit API
        // outage. The console marks live fields unknown and keeps polling.
        liveStateAvailable = false;
    }

    const tapestrySnapshot = await tapestrySnapshotPromise;
    const thumbnailEpoch = Math.floor(Date.now() / THUMBNAIL_REFRESH_MS);
    let queuePosition = 0;
    const participants = scheduledSession.participants.map((participant) => {
        const canPublish =
            participant.publishGrantedAt !== null &&
            participant.publishRevokedAt === null;
        const isWaiting = participant.raisedAt !== null && !canPublish;
        if (isWaiting) {
            queuePosition += 1;
        }
        const live = liveParticipants.get(participant.participantIdentity);
        const connected = liveStateAvailable ? Boolean(live) : null;
        const stageState = effectiveStageState({
            hasActiveGrant: canPublish,
            connected,
            publishedTrackCount: live?.media.length ?? 0,
        });
        const isAssignedFacilitator = participant.staffUser
            ? eventStaffPolicy(
                participant.staffUser.role,
                participant.staffUser.id === scheduledSession.facilitatorId,
            ).isAssignedFacilitator
            : false;
        let thumbnailUrl: string | null = null;
        if (tapestrySnapshot.available) {
            try {
                const tapestryId = tapestryParticipantId(participant.participantIdentity);
                if (tapestrySnapshot.participantIds.has(tapestryId)) {
                    thumbnailUrl = `/api/ops/sessions/${encodeURIComponent(scheduledSession.id)}/tapestry/tiles/${encodeURIComponent(tapestryId)}?v=${thumbnailEpoch}`;
                }
            } catch {
                // A missing/invalid secret is the same dignified fallback as
                // an absent or expired frame; never leak configuration detail.
            }
        }
        return {
            id: participant.id,
            identity: participant.participantIdentity,
            // The confirmed database alias is authoritative. LiveKit carries
            // a neutral audience name until publication and may be offline.
            displayName: participant.staffUser?.name ??
                participant.displayName?.trim() ??
                'Attendee',
            principalType: participant.staffUser ? 'staff' : 'attendee',
            staffRole: participant.staffUser?.role ?? null,
            isAssignedFacilitator,
            joinedAt: participant.joinedAt.toISOString(),
            leftAt: participant.leftAt?.toISOString() ?? null,
            raisedAt: participant.raisedAt?.toISOString() ?? null,
            queuePosition: isWaiting ? queuePosition : null,
            canPublish,
            stageState,
            grantVersion: participant.grantVersion,
            reconcileNeeded: participant.grantReconcileNeeded,
            connected,
            media: live?.media ?? [],
            // RoomService's ParticipantInfo does not expose connection quality.
            // Keep the field explicit so the UI never invents a value.
            connectionQuality: null,
            thumbnailUrl,
        };
    });

    return NextResponse.json({
        sessionId: scheduledSession.id,
        sessionStatus: scheduledSession.status,
        maxPublishers: scheduledSession.maxPublishers,
        activePublishers: participants.filter(
            (participant) => participant.stageState === 'ON_STAGE',
        ).length,
        // Julián's facilitator slot is reserved even before preflight creates
        // his participant row. Exclude an active facilitator row to avoid
        // double-counting that reservation.
        grantedPublishers: 1 + participants.filter(
            (participant) =>
                participant.canPublish &&
                !participant.isAssignedFacilitator,
        ).length,
        liveStateAvailable,
        tapestryThumbnailsAvailable: tapestrySnapshot.available,
        thumbnailFreshForSeconds: Math.ceil(tapestrySnapshot.frameTtlMs / 1_000),
        participants,
    });
}

function trackSourceLabel(source: TrackSource): string {
    switch (source) {
        case TrackSource.CAMERA:
            return 'CAMERA';
        case TrackSource.MICROPHONE:
            return 'MICROPHONE';
        case TrackSource.SCREEN_SHARE:
            return 'SCREEN_SHARE';
        case TrackSource.SCREEN_SHARE_AUDIO:
            return 'SCREEN_SHARE_AUDIO';
        default:
            return 'UNKNOWN';
    }
}
