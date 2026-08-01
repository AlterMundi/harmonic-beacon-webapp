/**
 * Operator event health — the subsystem checks behind `/api/ops/health`.
 *
 * One report, six subsystems, three states:
 *
 *   green  — verified working within the timeout.
 *   yellow — degraded but cuttable under the roadmap's cut-lines. Only the
 *            tapestry may be yellow; the event can run without it.
 *   red    — launch-blocking: PostgreSQL, the LiveKit API, a LIVE stage room,
 *            the bed publisher, or the six-publisher grant invariant.
 *
 * All external calls are bounded by `timeoutMs` so a hung subsystem turns the
 * report non-green instead of hanging the dashboard. Errors are redacted
 * before they enter the report: a pg failure embeds the full connection
 * string (password included) in `error.message`, and this JSON is rendered in
 * an operator browser.
 *
 * Dependencies are injected so the tests can simulate each subsystem's loss
 * without a database, a LiveKit server, or the tapestry service.
 */

import { TrackType } from 'livekit-server-sdk';

import { prisma } from '@/lib/db';
import { getRoomService } from '@/lib/livekit-server';
import { redactError } from '@/lib/redact';
import { OperationTimeoutError, withTimeout } from '@/lib/with-timeout';

export type HealthLevel = 'green' | 'yellow' | 'red';

export interface SubsystemCheck {
    status: HealthLevel;
    /** What was verified, or what is wrong — safe to show an operator. */
    detail: string;
    latencyMs: number;
    /** Redacted one-liner, present only when the check is not green. */
    error?: string;
}

export interface WatchedSession {
    id: string;
    title: string;
    status: 'SCHEDULED' | 'LIVE';
    roomName: string;
    maxPublishers: number;
}

export interface RoomSummary {
    name: string;
    numParticipants: number;
}

export interface RoomParticipantSummary {
    identity: string;
    hasPublishedAudio: boolean;
}

export interface OperatorHealthDeps {
    checkDatabase: () => Promise<unknown>;
    /** The LIVE session, or the next SCHEDULED one when nothing is live. */
    getWatchedSession: () => Promise<WatchedSession | null>;
    /** Participants holding an unrevoked publish grant for the session. */
    countActivePublishGrants: (sessionId: string) => Promise<number>;
    listRooms: () => Promise<RoomSummary[]>;
    listParticipants: (roomName: string) => Promise<RoomParticipantSummary[]>;
    fetchTapestryHealth: () => Promise<{ ok: boolean }>;
    tapestryUrl: string;
    bedRoomName: string;
    bedPublisherIdentity: string;
    timeoutMs: number;
}

export interface OperatorHealthReport {
    /** Worst state across all checks. */
    status: HealthLevel;
    checkedAt: string;
    session: {
        id: string;
        title: string;
        status: 'SCHEDULED' | 'LIVE';
    } | null;
    checks: {
        postgres: SubsystemCheck;
        livekit: SubsystemCheck;
        stageRoom: SubsystemCheck;
        publisherGrants: SubsystemCheck;
        bedPublisher: SubsystemCheck;
        tapestry: SubsystemCheck;
    };
}

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_ERROR_LENGTH = 200;

function ok(detail: string, latencyMs: number): SubsystemCheck {
    return { status: 'green', detail, latencyMs };
}

function notOk(
    status: Exclude<HealthLevel, 'green'>,
    detail: string,
    latencyMs: number,
    error: unknown,
): SubsystemCheck {
    return {
        status,
        detail,
        latencyMs,
        error: redactError(error).slice(0, MAX_ERROR_LENGTH),
    };
}

/** Time and capture one probe; never throws. */
async function probe(
    run: () => Promise<SubsystemCheck>,
    failureStatus: Exclude<HealthLevel, 'green'>,
    failureDetail: string,
): Promise<SubsystemCheck> {
    const started = Date.now();
    try {
        return await run();
    } catch (error) {
        return notOk(failureStatus, failureDetail, Date.now() - started, error);
    }
}

/**
 * Collect the full report. Every subsystem is probed even when others have
 * already failed — an operator needs the whole board, not the first red.
 */
export async function collectOperatorHealth(
    deps: OperatorHealthDeps = productionDeps(),
): Promise<OperatorHealthReport> {
    const timeout = deps.timeoutMs;

    // PostgreSQL and tapestry are independent; probe them in parallel.
    const [postgres, tapestry] = await Promise.all([
        probe(async () => {
            const started = Date.now();
            await withTimeout(deps.checkDatabase(), timeout, 'PostgreSQL check');
            return ok('PostgreSQL answered SELECT 1', Date.now() - started);
        }, 'red', 'PostgreSQL unreachable — entitlement and login cannot be verified'),

        probe(async () => {
            const started = Date.now();
            const health = await withTimeout(
                deps.fetchTapestryHealth(),
                timeout,
                'Tapestry check',
            );
            if (!health.ok) {
                throw new Error('Tapestry health endpoint returned a non-OK status');
            }
            return ok('Tapestry health endpoint answered', Date.now() - started);
        }, 'yellow', 'Tapestry unreachable — cuttable per the runbook; stage and audio are unaffected'),
    ]);

    // The watched session comes from the database too, so it shares the
    // outage with the postgres check. "No session" and "database down" must
    // stay distinct: the first is green, the second makes every
    // database-backed check unverifiable.
    let watched: WatchedSession | null = null;
    let watchedUnknown = false;
    try {
        watched = await withTimeout(
            deps.getWatchedSession(),
            timeout,
            'Watched session query',
        );
    } catch {
        watchedUnknown = true;
    }

    // LiveKit API: list rooms once and derive the stage-room check from it.
    let rooms: RoomSummary[] | null = null;
    let livekit: SubsystemCheck;
    {
        const started = Date.now();
        try {
            rooms = await withTimeout(deps.listRooms(), timeout, 'LiveKit API check');
            livekit = ok(`LiveKit API answered (${rooms.length} room(s))`, Date.now() - started);
        } catch (error) {
            livekit = notOk(
                'red',
                'LiveKit API unreachable — nobody can join or publish',
                Date.now() - started,
                error,
            );
        }
    }

    const stageRoom: SubsystemCheck = evaluateStageRoom(watched, watchedUnknown, rooms, livekit);
    const publisherGrants: SubsystemCheck = await evaluatePublisherGrants(
        deps,
        watched,
        watchedUnknown,
        timeout,
    );
    const bedPublisher: SubsystemCheck = await evaluateBedPublisher(deps, livekit, timeout);

    const checks = { postgres, livekit, stageRoom, publisherGrants, bedPublisher, tapestry };
    const status = worstOf(Object.values(checks).map((check) => check.status));

    return {
        status,
        checkedAt: new Date().toISOString(),
        session: watched
            ? { id: watched.id, title: watched.title, status: watched.status }
            : null,
        checks,
    };
}

function evaluateStageRoom(
    watched: WatchedSession | null,
    watchedUnknown: boolean,
    rooms: RoomSummary[] | null,
    livekit: SubsystemCheck,
): SubsystemCheck {
    if (watchedUnknown) {
        return {
            status: 'red',
            detail: 'Cannot determine the stage room: database unreachable',
            latencyMs: 0,
        };
    }
    if (livekit.status !== 'green' || rooms === null) {
        return {
            status: 'red',
            detail: 'Cannot verify the stage room: LiveKit API unreachable',
            latencyMs: 0,
        };
    }
    if (!watched) {
        return ok('No live or scheduled session to watch', 0);
    }
    const room = rooms.find((candidate) => candidate.name === watched.roomName);
    if (room) {
        return ok(
            `Stage room exists (${room.numParticipants} participant(s), session ${watched.status})`,
            0,
        );
    }
    if (watched.status === 'LIVE') {
        return {
            status: 'red',
            detail:
                'Session is LIVE but the stage room does not exist in LiveKit — attendees cannot join',
            latencyMs: 0,
        };
    }
    return ok('Stage room not created yet — LiveKit creates it on first join', 0);
}

async function evaluatePublisherGrants(
    deps: OperatorHealthDeps,
    watched: WatchedSession | null,
    watchedUnknown: boolean,
    timeout: number,
): Promise<SubsystemCheck> {
    if (watchedUnknown) {
        return {
            status: 'red',
            detail: 'Cannot count publish grants: database unreachable',
            latencyMs: 0,
        };
    }
    if (!watched) {
        return ok('No session to audit publish grants for', 0);
    }
    const started = Date.now();
    try {
        const count = await withTimeout(
            deps.countActivePublishGrants(watched.id),
            timeout,
            'Publish grant count',
        );
        if (count > watched.maxPublishers) {
            // Invariant alarm: the cap is six, Julián plus five auxiliaries.
            // More rows than that means the stage-control invariant broke and
            // a seventh publisher may be live.
            return {
                status: 'red',
                detail: `INVARIANT VIOLATED: ${count} active publish grants exceed the ${watched.maxPublishers}-publisher cap`,
                latencyMs: Date.now() - started,
            };
        }
        return ok(
            `${count}/${watched.maxPublishers} active publish grants`,
            Date.now() - started,
        );
    } catch (error) {
        return notOk(
            'red',
            'Cannot count publish grants: database unreachable',
            Date.now() - started,
            error,
        );
    }
}

async function evaluateBedPublisher(
    deps: OperatorHealthDeps,
    livekit: SubsystemCheck,
    timeout: number,
): Promise<SubsystemCheck> {
    if (livekit.status !== 'green') {
        return {
            status: 'red',
            detail: 'Cannot verify the bed publisher: LiveKit API unreachable',
            latencyMs: 0,
        };
    }
    const started = Date.now();
    try {
        const participants = await withTimeout(
            deps.listParticipants(deps.bedRoomName),
            timeout,
            'Bed room participant check',
        );
        const bot = participants.find(
            (participant) => participant.identity === deps.bedPublisherIdentity,
        );
        if (bot?.hasPublishedAudio) {
            return ok(
                `Bed publisher '${deps.bedPublisherIdentity}' is in '${deps.bedRoomName}' with a live audio track`,
                Date.now() - started,
            );
        }
        return {
            status: 'red',
            detail: bot
                ? `Bed publisher '${deps.bedPublisherIdentity}' is present but has no published audio track`
                : `Bed publisher '${deps.bedPublisherIdentity}' is not in room '${deps.bedRoomName}' — attendees hear no bed audio`,
            latencyMs: Date.now() - started,
        };
    } catch (error) {
        // LiveKit answers "room does not exist" for an empty bed room, which
        // lands here as a thrown error: same conclusion, nobody is publishing.
        return notOk(
            'red',
            `No bed audio in room '${deps.bedRoomName}' — attendees hear silence underneath the stage`,
            Date.now() - started,
            error,
        );
    }
}

function worstOf(statuses: HealthLevel[]): HealthLevel {
    if (statuses.includes('red')) return 'red';
    if (statuses.includes('yellow')) return 'yellow';
    return 'green';
}

/**
 * Wire the checks to the real services. Reads its configuration at call time
 * (per request), not at module load, so environment changes and tests never
 * fight a cached snapshot.
 */
export function productionDeps(options: {
    sessionId?: string;
    now?: Date;
} = {}): OperatorHealthDeps {
    const timeoutMs =
        Number(process.env.OPS_HEALTH_TIMEOUT_MS) > 0
            ? Number(process.env.OPS_HEALTH_TIMEOUT_MS)
            : DEFAULT_TIMEOUT_MS;

    return {
        timeoutMs,
        tapestryUrl: process.env.TAPESTRY_INTERNAL_URL || 'http://tapestry:3100',
        bedRoomName: process.env.LIVEKIT_ROOM_NAME || 'beacon',
        bedPublisherIdentity: process.env.BOT_IDENTITY || 'playlist-bot',

        checkDatabase: () => prisma.$queryRaw`SELECT 1`,

        getWatchedSession: async (): Promise<WatchedSession | null> => {
            const select = {
                id: true,
                title: true,
                status: true,
                roomName: true,
                maxPublishers: true,
            } as const;
            if (options.sessionId) {
                const selected = await prisma.scheduledSession.findFirst({
                    where: {
                        id: options.sessionId,
                        status: { in: ['SCHEDULED', 'LIVE'] },
                    },
                    select,
                });
                return selected
                    ? { ...selected, status: selected.status as WatchedSession['status'] }
                    : null;
            }

            // Prefer the most recently scheduled live event. An accidentally
            // stale LIVE row from an earlier session must not hijack the board.
            const live = await prisma.scheduledSession.findFirst({
                where: { status: 'LIVE' },
                orderBy: { scheduledAt: 'desc' },
                select,
            });
            const now = options.now ?? new Date();
            const session =
                live ??
                (await prisma.scheduledSession.findFirst({
                    where: {
                        status: 'SCHEDULED',
                        scheduledAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
                    },
                    orderBy: { scheduledAt: 'asc' },
                    select,
                }));
            if (!session) {
                return null;
            }
            // The queries constrain status to LIVE/SCHEDULED; the Prisma enum
            // is wider, so narrow it here at the boundary.
            return { ...session, status: session.status as WatchedSession['status'] };
        },

        countActivePublishGrants: (sessionId) =>
            prisma.sessionParticipant.count({
                where: {
                    scheduledSessionId: sessionId,
                    publishGrantedAt: { not: null },
                    publishRevokedAt: null,
                },
            }),

        listRooms: async () => {
            const rooms = await getRoomService().listRooms();
            return rooms.map((room) => ({
                name: room.name,
                numParticipants: room.numParticipants,
            }));
        },

        listParticipants: async (roomName) => {
            const participants = await getRoomService().listParticipants(roomName);
            return participants.map((participant) => ({
                identity: participant.identity,
                hasPublishedAudio: participant.tracks.some(
                    (track) => track.type === TrackType.AUDIO,
                ),
            }));
        },

        fetchTapestryHealth: async () => {
            // The tapestry /health endpoint is unauthenticated by design
            // (counts only, never identifiers), so no shared secret crosses
            // this boundary and nothing here can leak it.
            const response = await fetch(
                `${process.env.TAPESTRY_INTERNAL_URL || 'http://tapestry:3100'}/health`,
                { cache: 'no-store' },
            );
            return { ok: response.ok };
        },
    };
}

export { OperationTimeoutError };
