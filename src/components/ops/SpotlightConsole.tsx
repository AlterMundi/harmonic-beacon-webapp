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

function participantLabel(participant: ConsoleParticipant): string {
    if (participant.principalType === 'staff') {
        return participant.displayName;
    }
    return `${participant.displayName} · ID ${participant.identity.slice(-8)}`;
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
        if (participant.connected !== true) {
            setActionError({
                code: 'participant_not_connected',
                message: 'This participant is not connected. Wait for them to rejoin or remove the stale hand.',
            });
            return;
        }
        const label = participantLabel(participant);
        const promoted = await runAction(
            `promote:${participant.id}`,
            { action: 'promote', participantId: participant.id, reason: 'Hand queue' },
            `${label} has the floor`,
        );
        if (!promoted) {
            return;
        }
        await runAction(
            `lower:${participant.id}`,
            { action: 'lower_hand', participantId: participant.id, reason: 'Promoted to stage' },
            `${label} has the floor`,
        );
    }

    const inviteToStage = (participant: ConsoleParticipant) =>
        runAction(
            `promote:${participant.id}`,
            { action: 'promote', participantId: participant.id, reason: 'Invited from audience' },
            `${participantLabel(participant)} was invited to the stage`,
        );

    const takeFloor = (participant: ConsoleParticipant) =>
        runAction(
            `demote:${participant.id}`,
            { action: 'demote', participantId: participant.id, reason: 'Operator took the floor' },
            `${participantLabel(participant)} was taken off the stage`,
        );

    const removeHand = (participant: ConsoleParticipant) =>
        runAction(
            `lower:${participant.id}`,
            { action: 'lower_hand', participantId: participant.id, reason: 'Removed from hand queue' },
            `${participantLabel(participant)}'s hand was lowered`,
        );

    const muteTrack = (participant: ConsoleParticipant, track: LiveTrack) =>
        runAction(
            `mute:${track.trackSid}`,
            {
                action: 'mute',
                participantId: participant.id,
                trackSid: track.trackSid,
                muted: true,
            },
            `${track.source.toLowerCase()} muted; the participant can re-enable it`,
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
                <div role="alert" className="rounded border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-2 text-sm text-[var(--danger)]">
                    Polling failed ({pollError}) — showing the last known state. Retrying every {POLL_INTERVAL_MS / 1000}s.
                </div>
            ) : null}
            {snapshot && !snapshot.liveStateAvailable ? (
                <div role="alert" className="rounded border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-2 text-sm text-[var(--warning)]">
                    LiveKit live state unavailable — connection and media are unknown. Durable grants and the hand queue are still current.
                </div>
            ) : null}
            {reconcilePending.length > 0 ? (
                <div role="alert" className="rounded border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-2 text-sm text-[var(--warning)]">
                    {reconcilePending.length} participant{reconcilePending.length !== 1 ? 's' : ''} need{reconcilePending.length === 1 ? 's' : ''} reconciliation — the durable grant and LiveKit disagree.
                </div>
            ) : null}
            {actionError ? (
                <div role="alert" className="rounded border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-2 text-sm text-[var(--danger)]">
                    {actionError.code === 'stage_full'
                        ? `Stage is full — this hand stays #${actionError.queuePosition ?? '?'} in the queue. Take a floor first.`
                        : actionError.code === 'participant_not_connected'
                          ? actionError.message
                        : actionError.code === 'livekit_failed' && actionError.reconcileNeeded
                          ? `${actionError.message}. The durable grant was revoked; press Reconcile to retry the LiveKit update.`
                          : `${actionError.message} (${actionError.code})`}
                </div>
            ) : null}
            {notice ? (
                <div role="status" className="rounded border border-[var(--lime)]/40 bg-[var(--lime)]/10 px-4 py-2 text-sm text-[var(--lime)]">
                    {notice}
                </div>
            ) : null}

            <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-secondary)]">
                    Stage: {snapshot ? `${snapshot.activePublishers}/${snapshot.maxPublishers}` : '…'} publishers ·{' '}
                    {queue.length} hand{queue.length !== 1 ? 's' : ''} raised
                </span>
                <button
                    type="button"
                    onClick={() => void reconcile()}
                    disabled={busyKey === 'reconcile'}
                    className="rounded border border-[var(--border-subtle)] px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
                >
                    Reconcile grants
                </button>
            </div>

            {/* Hand queue comes first so a facilitator never has to hunt below the stage. */}
            <div>
                <h2 className="mb-1 text-lg font-semibold text-[var(--cream)]">Hand queue</h2>
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                    Raised hands appear here automatically. Give floor moves a connected person to the stage; Remove hand clears the request.
                </p>
                {queue.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">No hands raised.</p>
                ) : (
                    <ul className="space-y-2">
                        {queue.map((participant) => (
                            <li key={participant.id} className="flex items-center justify-between gap-3 operational-panel">
                                <div className="min-w-0">
                                    <span className="font-medium text-[var(--cream)]">#{participant.queuePosition} — {participantLabel(participant)}</span>
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
                                        disabled={busyKey !== null || participant.connected !== true}
                                        onClick={() => void giveFloor(participant)}
                                        title={participant.connected === true ? undefined : 'Participant must be connected before joining the stage'}
                                        className="min-h-10 rounded border border-[var(--lime)] px-3 py-2 text-xs text-[var(--lime)] hover:bg-[var(--lime)]/10 disabled:opacity-50"
                                    >
                                        {participant.connected === true ? 'Give floor' : 'Waiting for reconnect'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busyKey !== null}
                                        onClick={() => void removeHand(participant)}
                                        className="min-h-10 rounded border border-[var(--border-subtle)] px-3 py-2 text-xs hover:bg-white/5 disabled:opacity-50"
                                    >
                                        Remove hand
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Stage */}
            <div>
                <h2 className="mb-2 text-lg font-semibold text-[var(--cream)]">On stage</h2>
                {onStage.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">Nobody has the floor yet.</p>
                ) : (
                    <ul className="space-y-2">
                        {onStage.map((participant) => (
                            <li key={participant.id} className="operational-panel">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <span className="font-medium text-[var(--cream)]">{participantLabel(participant)}</span>
                                        {participant.staffRole ? (
                                            <span className="ml-2 text-[10px] uppercase text-[var(--text-muted)]">{participant.staffRole}</span>
                                        ) : null}
                                        <div className="text-xs text-[var(--text-secondary)]">
                                            {connectionBadge(participant)}
                                            {participant.connectionQuality ? ` · ${participant.connectionQuality.toLowerCase()} quality` : ''}
                                            {' · '}{mediaSummary(participant)}
                                            {participant.reconcileNeeded ? ' · reconcile needed' : ''}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                                        {participant.media.map((track) => track.muted ? (
                                            <span key={track.trackSid} className="text-xs text-[var(--text-muted)]">
                                                Participant must re-enable {track.source.toLowerCase()}
                                            </span>
                                        ) : (
                                            <button
                                                key={track.trackSid}
                                                type="button"
                                                disabled={busyKey !== null}
                                                onClick={() => void muteTrack(participant, track)}
                                                className="rounded border border-[var(--border-subtle)] px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
                                            >
                                                Mute {track.source.toLowerCase()}
                                            </button>
                                        ))}
                                        {participant.staffRole !== 'FACILITATOR' ? (
                                            <button
                                                type="button"
                                                disabled={busyKey !== null}
                                                onClick={() => void takeFloor(participant)}
                                                className="min-h-10 rounded border border-[var(--danger)] px-3 py-2 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
                                            >
                                                Take floor
                                            </button>
                                        ) : (
                                            <span className="text-xs font-medium text-[var(--text-muted)]">
                                                Reserved facilitator slot
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Audience */}
            <div>
                <h2 className="mb-2 text-lg font-semibold text-[var(--cream)]">Audience ({audience.length})</h2>
                {audience.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">No other participants.</p>
                ) : (
                    <ul className="space-y-1 text-sm">
                        {audience.map((participant) => (
                            <li key={participant.id} className="flex items-center justify-between rounded px-2 py-1">
                                <span className="text-[var(--cream)]">
                                    {participantLabel(participant)}
                                    {participant.staffRole ? (
                                        <span className="ml-2 text-[10px] uppercase text-[var(--text-muted)]">{participant.staffRole}</span>
                                    ) : null}
                                </span>
                                <span className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                                    <span>
                                        {connectionBadge(participant)}
                                        {participant.connectionQuality ? ` · ${participant.connectionQuality.toLowerCase()}` : ''}
                                    </span>
                                    {participant.connected === true ? (
                                        <button
                                            type="button"
                                            disabled={busyKey !== null}
                                            onClick={() => void inviteToStage(participant)}
                                            className="min-h-10 rounded border border-[var(--lime)] px-3 py-2 text-xs text-[var(--lime)] hover:bg-[var(--lime)]/10 disabled:opacity-50"
                                        >
                                            Invite to stage
                                        </button>
                                    ) : null}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <p className="text-xs text-[var(--text-muted)]">
                Signed in as {role}. Queue refreshes every {POLL_INTERVAL_MS / 1000}s; durable grants are the authority.
            </p>
        </section>
    );
}
