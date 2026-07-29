'use client';

/**
 * WS3-02 spotlight console: the hand queue plus the live stage, polled from
 * `/api/ops/sessions/[id]/participants` every two seconds.
 *
 * Polling is deliberate for the weekend: every operator — Julián and both
 * operators at once — renders the same database-backed queue, survives a
 * refresh, and sees joins/leaves/grant changes within one or two intervals.
 * All mutations go through the WS3-01 stage endpoint, which serializes
 * promotions on the session row; two operators clicking "Give floor" on the
 * same last slot produce one promotion and one `stage_full`, shown here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 2_000;

type LiveTrack = {
    trackSid: string;
    source: string;
    muted: boolean;
};

type ConsoleParticipant = {
    id: string;
    identity: string;
    displayName: string;
    principalType: 'staff' | 'attendee';
    staffRole: string | null;
    joinedAt: string;
    leftAt: string | null;
    raisedAt: string | null;
    queuePosition: number | null;
    canPublish: boolean;
    grantVersion: number;
    reconcileNeeded: boolean;
    connected: boolean | null;
    media: LiveTrack[];
    connectionQuality: string | null;
};

/** Normalize a participant from the API: fill optional live-state fields. */
function normalizeParticipant(p: ConsoleParticipant): ConsoleParticipant {
    return {
        ...p,
        connected: p.connected ?? null,
        media: p.media ?? [],
        connectionQuality: p.connectionQuality ?? null,
    };
}

type ParticipantsSnapshot = {
    sessionId: string;
    maxPublishers: number;
    activePublishers: number;
    liveStateAvailable: boolean;
    participants: ConsoleParticipant[];
};

type ActionError = {
    code: string;
    message: string;
    queuePosition?: number;
    reconcileNeeded?: boolean;
};

type Props = {
    sessionId: string;
    role: 'FACILITATOR' | 'OPERATOR' | 'ADMIN';
};

async function postStage(
    sessionId: string,
    body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
    const response = await fetch(`/api/ops/sessions/${sessionId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, data };
}

function describeActionError(status: number, data: Record<string, unknown>): ActionError {
    const code = typeof data.error === 'string' ? data.error : 'request_failed';
    const message = typeof data.message === 'string'
        ? data.message
        : `Request failed (HTTP ${status})`;
    return {
        code,
        message,
        queuePosition: typeof data.queuePosition === 'number'
            ? data.queuePosition
            : undefined,
        reconcileNeeded: data.reconcileNeeded === true,
    };
}

function formatQueueAge(raisedAt: string, nowMs: number): string {
    const seconds = Math.max(0, Math.floor((nowMs - new Date(raisedAt).getTime()) / 1000));
    const minutes = Math.floor(seconds / 60);
    return minutes > 0
        ? `${minutes}m ${(seconds % 60).toString().padStart(2, '0')}s`
        : `${seconds}s`;
}

function connectionBadge(participant: ConsoleParticipant): string {
    if (participant.connected === null) {
        return 'live state unknown';
    }
    return participant.connected ? 'connected' : 'left';
}

function mediaSummary(participant: ConsoleParticipant): string {
    if (participant.connected !== true) {
        return '—';
    }
    if (participant.media.length === 0) {
        return 'no tracks published';
    }
    return participant.media
        .map((track) => `${track.source.toLowerCase()} ${track.muted ? 'muted' : 'live'}`)
        .join(' · ');
}

export default function SpotlightConsole({ sessionId, role }: Props) {
    const [snapshot, setSnapshot] = useState<ParticipantsSnapshot | null>(null);
    const [pollError, setPollError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<ActionError | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const mounted = useRef(true);

    const refresh = useCallback(async () => {
        try {
            const response = await fetch(
                `/api/ops/sessions/${sessionId}/participants`,
                { cache: 'no-store' },
            );
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const body = (await response.json()) as ParticipantsSnapshot;
            if (mounted.current) {
                setSnapshot({
                    ...body,
                    participants: body.participants.map(normalizeParticipant),
                });
                setPollError(null);
                setNowMs(Date.now());
            }
        } catch (error) {
            if (mounted.current) {
                setPollError(
                    error instanceof Error ? error.message : 'Polling failed',
                );
            }
        }
    }, [sessionId]);

    useEffect(() => {
        mounted.current = true;
        void refresh();
        const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
        return () => {
            mounted.current = false;
            clearInterval(timer);
        };
    }, [refresh]);

    async function runAction(
        key: string,
        body: Record<string, unknown>,
        okMessage: string,
    ): Promise<boolean> {
        setBusyKey(key);
        setActionError(null);
        setNotice(null);
        try {
            const { status, data } = await postStage(sessionId, body);
            if (status >= 400) {
                setActionError(describeActionError(status, data));
                return false;
            }
            setNotice(okMessage);
            return true;
        } catch {
            setActionError({
                code: 'request_failed',
                message: 'The stage endpoint could not be reached',
            });
            return false;
        } finally {
            setBusyKey(null);
            void refresh();
        }
    }

    async function giveFloor(participant: ConsoleParticipant) {
        const promoted = await runAction(
            `promote:${participant.id}`,
            { action: 'promote', participantId: participant.id, reason: 'Hand queue' },
            `${participant.displayName} has the floor`,
        );
        if (!promoted) {
            // stage_full / LiveKit failure leave the hand raised; the banner
            // above says which one happened.
            return;
        }
        // The hand is served: remove it so a later demotion does not drop the
        // attendee back into the queue at their original timestamp. Failure is
        // non-fatal — the operator can still use Remove hand.
        await runAction(
            `lower:${participant.id}`,
            { action: 'lower_hand', participantId: participant.id, reason: 'Promoted to stage' },
            `${participant.displayName} has the floor`,
        );
    }

    const takeFloor = (participant: ConsoleParticipant) =>
        runAction(
            `demote:${participant.id}`,
            { action: 'demote', participantId: participant.id, reason: 'Operator took the floor' },
            `${participant.displayName} was taken off the stage`,
        );

    const removeHand = (participant: ConsoleParticipant) =>
        runAction(
            `lower:${participant.id}`,
            { action: 'lower_hand', participantId: participant.id, reason: 'Removed from hand queue' },
            `${participant.displayName}'s hand was lowered`,
        );

    const setTrackMuted = (participant: ConsoleParticipant, track: LiveTrack, muted: boolean) =>
        runAction(
            `mute:${track.trackSid}`,
            {
                action: 'mute',
                participantId: participant.id,
                trackSid: track.trackSid,
                muted,
            },
            `${track.source.toLowerCase()} ${muted ? 'muted' : 'unmuted'}`,
        );

    const reconcile = () =>
        runAction(
            'reconcile',
            { action: 'reconcile' },
            'Reconciliation finished',
        );

    const all = snapshot?.participants ?? [];
    const onStage = all.filter((participant) => participant.canPublish);
    const queue = all
        .filter((participant) => participant.queuePosition !== null)
        .sort((left, right) => (left.queuePosition ?? 0) - (right.queuePosition ?? 0));
    const audience = all.filter(
        (participant) => !participant.canPublish && participant.queuePosition === null,
    );
    const reconcilePending = all.filter((participant) => participant.reconcileNeeded);

    return (
        <section className="space-y-6" aria-live="polite">
            {/* Status banners */}
            {pollError ? (
                <div role="alert" className="rounded border border-red-600 bg-red-950/40 px-4 py-2 text-sm text-red-300">
                    Polling failed ({pollError}) — showing the last known state. Retrying every {POLL_INTERVAL_MS / 1000}s.
                </div>
            ) : null}
            {snapshot && !snapshot.liveStateAvailable ? (
                <div role="alert" className="rounded border border-amber-500 bg-amber-950/40 px-4 py-2 text-sm text-amber-300">
                    LiveKit live state unavailable — connected/media/quality columns are from the last durable read. Consider Reconcile.
                </div>
            ) : null}
            {reconcilePending.length > 0 ? (
                <div role="alert" className="rounded border border-amber-500 bg-amber-950/40 px-4 py-2 text-sm text-amber-300">
                    {reconcilePending.length} participant{reconcilePending.length !== 1 ? 's' : ''} need{reconcilePending.length === 1 ? 's' : ''} reconciliation — the durable grant and LiveKit disagree.
                </div>
            ) : null}
            {actionError ? (
                <div role="alert" className="rounded border border-red-600 bg-red-950/40 px-4 py-2 text-sm text-red-300">
                    {actionError.code === 'stage_full'
                        ? `Stage is full — this hand stays #${actionError.queuePosition ?? '?'} in the queue. Take a floor first.`
                        : actionError.code === 'livekit_failed'
                          ? `${actionError.message}. The durable grant was revoked; press Reconcile to retry the LiveKit update.`
                          : `${actionError.message} (${actionError.code})`}
                </div>
            ) : null}
            {notice ? (
                <div role="status" className="rounded border border-green-600 bg-green-950/40 px-4 py-2 text-sm text-green-300">
                    {notice}
                </div>
            ) : null}

            <div className="flex items-center justify-between text-sm">
                <span>
                    Stage: {snapshot ? `${snapshot.activePublishers}/${snapshot.maxPublishers}` : '…'} publishers ·{' '}
                    {queue.length} hand{queue.length !== 1 ? 's' : ''} raised
                </span>
                <button
                    type="button"
                    onClick={() => void reconcile()}
                    disabled={busyKey === 'reconcile'}
                    className="rounded border border-current px-3 py-1 text-xs hover:opacity-80 disabled:opacity-50"
                >
                    Reconcile grants
                </button>
            </div>

            {/* Stage */}
            <div>
                <h2 className="mb-2 text-lg font-semibold">On stage</h2>
                {onStage.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">Nobody has the floor yet.</p>
                ) : (
                    <ul className="space-y-2">
                        {onStage.map((participant) => (
                            <li key={participant.id} className="rounded border border-[var(--border,#333)] px-4 py-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <span className="font-medium">{participant.displayName}</span>
                                        {participant.staffRole ? (
                                            <span className="ml-2 text-xs uppercase text-[var(--text-secondary)]">{participant.staffRole}</span>
                                        ) : null}
                                        <div className="text-xs text-[var(--text-secondary)]">
                                            {connectionBadge(participant)}
                                            {participant.connectionQuality ? ` · ${participant.connectionQuality.toLowerCase()} quality` : ''}
                                            {' · '}{mediaSummary(participant)}
                                            {participant.reconcileNeeded ? ' · reconcile needed' : ''}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                                        {participant.media.map((track) => (
                                            <button
                                                key={track.trackSid}
                                                type="button"
                                                disabled={busyKey !== null}
                                                onClick={() => void setTrackMuted(participant, track, !track.muted)}
                                                className="rounded border border-current px-2 py-1 text-xs hover:opacity-80 disabled:opacity-50"
                                            >
                                                {track.muted ? 'Unmute' : 'Mute'} {track.source.toLowerCase()}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            disabled={busyKey !== null}
                                            onClick={() => void takeFloor(participant)}
                                            className="rounded border border-red-500 px-2 py-1 text-xs text-red-300 hover:opacity-80 disabled:opacity-50"
                                        >
                                            Take floor
                                        </button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Hand queue */}
            <div>
                <h2 className="mb-2 text-lg font-semibold">Hand queue</h2>
                {queue.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">No hands raised.</p>
                ) : (
                    <ul className="space-y-2">
                        {queue.map((participant) => (
                            <li key={participant.id} className="flex items-center justify-between gap-3 rounded border border-[var(--border,#333)] px-4 py-3">
                                <div className="min-w-0">
                                    <span className="font-medium">#{participant.queuePosition} — {participant.displayName}</span>
                                    <div className="text-xs text-[var(--text-secondary)]">
                                        waiting {participant.raisedAt ? formatQueueAge(participant.raisedAt, nowMs) : '…'}
                                        {' · '}{connectionBadge(participant)}
                                        {participant.connectionQuality ? ` · ${participant.connectionQuality.toLowerCase()} quality` : ''}
                                        {participant.reconcileNeeded ? ' · reconcile needed' : ''}
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <button
                                        type="button"
                                        disabled={busyKey !== null}
                                        onClick={() => void giveFloor(participant)}
                                        className="rounded border border-green-500 px-2 py-1 text-xs text-green-300 hover:opacity-80 disabled:opacity-50"
                                    >
                                        Give floor
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busyKey !== null}
                                        onClick={() => void removeHand(participant)}
                                        className="rounded border border-current px-2 py-1 text-xs hover:opacity-80 disabled:opacity-50"
                                    >
                                        Remove hand
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Audience */}
            <div>
                <h2 className="mb-2 text-lg font-semibold">Audience ({audience.length})</h2>
                {audience.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">No other participants.</p>
                ) : (
                    <ul className="space-y-1 text-sm">
                        {audience.map((participant) => (
                            <li key={participant.id} className="flex items-center justify-between rounded px-2 py-1">
                                <span>
                                    {participant.displayName}
                                    {participant.staffRole ? (
                                        <span className="ml-2 text-xs uppercase text-[var(--text-secondary)]">{participant.staffRole}</span>
                                    ) : null}
                                </span>
                                <span className="text-xs text-[var(--text-secondary)]">
                                    {connectionBadge(participant)}
                                    {participant.connectionQuality ? ` · ${participant.connectionQuality.toLowerCase()}` : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <p className="text-xs text-[var(--text-secondary)]">
                Signed in as {role}. Queue refreshes every {POLL_INTERVAL_MS / 1000}s; durable grants are the authority.
            </p>
        </section>
    );
}
