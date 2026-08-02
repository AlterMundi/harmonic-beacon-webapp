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
import type { StaffRole } from '@prisma/client';
import { effectiveStageState, type EffectiveStageState } from '@/lib/stage-presence';
import type { Messages } from '@/lib/i18n';

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
    isAssignedFacilitator: boolean;
    joinedAt: string;
    leftAt: string | null;
    raisedAt: string | null;
    queuePosition: number | null;
    canPublish: boolean;
    stageState?: EffectiveStageState;
    grantVersion: number;
    reconcileNeeded: boolean;
    connected: boolean | null;
    media: LiveTrack[];
    connectionQuality: string | null;
    thumbnailUrl?: string | null;
};

/** Normalize a participant from the API: fill optional live-state fields. */
function normalizeParticipant(p: ConsoleParticipant): ConsoleParticipant {
    const connected = p.connected ?? null;
    const media = p.media ?? [];
    return {
        ...p,
        connected,
        media,
        stageState: p.stageState ?? effectiveStageState({
            hasActiveGrant: p.canPublish,
            connected,
            // A current publication is LiveKit's observable evidence that the
            // attendee accepted this connection's invitation.
            publishedTrackCount: media.length,
        }),
        connectionQuality: p.connectionQuality ?? null,
        isAssignedFacilitator: p.isAssignedFacilitator ?? false,
        thumbnailUrl: typeof p.thumbnailUrl === 'string' ? p.thumbnailUrl : null,
    };
}

type ParticipantsSnapshot = {
    sessionId: string;
    sessionStatus?: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
    maxPublishers: number;
    activePublishers: number;
    grantedPublishers?: number;
    liveStateAvailable: boolean;
    tapestryThumbnailsAvailable?: boolean;
    thumbnailFreshForSeconds?: number;
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
    role: StaffRole;
    copy: Messages['ops']['spotlight'];
    staffRoles: Messages['staffRoles'];
    onSummary?: (summary: SpotlightSummary) => void;
};

export type SpotlightSummary = {
    activePublishers: number;
    maxPublishers: number;
    handCount: number;
    nextName: string | null;
    reconcileCount: number;
    liveStateAvailable: boolean;
    sessionStatus?: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
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

function fill(template: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
    );
}

function describeActionError(
    status: number,
    data: Record<string, unknown>,
    copy: Messages['ops']['spotlight'],
): ActionError {
    const code = typeof data.error === 'string' ? data.error : 'request_failed';
    const message = typeof data.message === 'string'
        ? data.message
        : fill(copy.requestFailed, { status });
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

function connectionBadge(
    participant: ConsoleParticipant,
    copy: Messages['ops']['spotlight'],
): string {
    if (participant.connected === null) {
        return copy.liveUnknown;
    }
    return participant.connected ? copy.connected : copy.disconnected;
}

function mediaSummary(
    participant: ConsoleParticipant,
    copy: Messages['ops']['spotlight'],
): string {
    if (participant.connected !== true) {
        return '—';
    }
    if (participant.media.length === 0) {
        return copy.noTracks;
    }
    return participant.media
        .map((track) => `${track.source.toLowerCase()} ${track.muted ? copy.muted : copy.trackLive}`)
        .join(' · ');
}

function roleLabel(role: string | null, labels: Messages['staffRoles']): string | null {
    return role && role in labels
        ? labels[role as keyof Messages['staffRoles']]
        : role;
}

function participantLabel(participant: ConsoleParticipant): string {
    if (participant.principalType === 'staff') {
        return participant.displayName;
    }
    return `${participant.displayName} · ID ${participant.identity.slice(-8)}`;
}

function HandThumbnail({
    displayName,
    src,
    freshForSeconds,
    copy,
}: {
    displayName: string;
    src: string | null;
    freshForSeconds: number;
    copy: Messages['ops']['spotlight'];
}) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const showImage = Boolean(src) && failedSrc !== src;

    return (
        <div className="flex w-14 shrink-0 flex-col items-center gap-1">
            {showImage ? (
                // The URL is staff-only and HMAC-addressed; no name/email is
                // present in the path. Failure converges to the same fallback.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={src!}
                    alt={fill(copy.recentSnapshotAlt, { name: displayName })}
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailedSrc(src)}
                    className="h-12 w-12 rounded-full border border-[var(--gold)]/40 object-cover"
                />
            ) : (
                <span
                    role="img"
                    aria-label={fill(copy.noSnapshotAlt, { name: displayName })}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-alt)] text-lg text-[var(--text-muted)]"
                >
                    ◌
                </span>
            )}
            <span className="text-center text-[9px] leading-tight text-[var(--text-muted)]" aria-hidden="true">
                {showImage ? `≤${freshForSeconds}s` : copy.noImage}
            </span>
        </div>
    );
}

export default function SpotlightConsole({ sessionId, role, copy, staffRoles, onSummary }: Props) {
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
                const participants = body.participants.map(normalizeParticipant);
                setSnapshot({
                    ...body,
                    participants,
                });
                const queue = participants
                    .filter((participant) => participant.queuePosition !== null)
                    .sort((left, right) => (left.queuePosition ?? 0) - (right.queuePosition ?? 0));
                onSummary?.({
                    activePublishers: body.activePublishers,
                    maxPublishers: body.maxPublishers,
                    handCount: queue.length,
                    nextName: queue[0]?.displayName ?? null,
                    reconcileCount: participants.filter((participant) => participant.reconcileNeeded).length,
                    liveStateAvailable: body.liveStateAvailable,
                    sessionStatus: body.sessionStatus,
                });
                setPollError(null);
                setNowMs(Date.now());
            }
        } catch (error) {
            if (mounted.current) {
                setPollError(
                    error instanceof Error ? error.message : copy.requestFailed,
                );
            }
        }
    }, [sessionId, onSummary, copy.requestFailed]);

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
                setActionError(describeActionError(status, data, copy));
                return false;
            }
            setNotice(okMessage);
            return true;
        } catch {
            setActionError({
                code: 'request_failed',
                message: copy.endpointUnavailable,
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
                message: copy.participantDisconnected,
            });
            return;
        }
        const label = participantLabel(participant);
        const promoted = await runAction(
            `promote:${participant.id}`,
            { action: 'promote', participantId: participant.id, reason: 'Hand queue' },
            fill(copy.hasFloor, { name: label }),
        );
        if (!promoted) {
            return;
        }
        await runAction(
            `lower:${participant.id}`,
            { action: 'lower_hand', participantId: participant.id, reason: 'Promoted to stage' },
            fill(copy.hasFloor, { name: label }),
        );
    }

    const inviteToStage = (participant: ConsoleParticipant) =>
        runAction(
            `promote:${participant.id}`,
            { action: 'promote', participantId: participant.id, reason: 'Invited from audience' },
            fill(copy.invitedNotice, { name: participantLabel(participant) }),
        );

    const takeFloor = (participant: ConsoleParticipant) =>
        runAction(
            `demote:${participant.id}`,
            { action: 'demote', participantId: participant.id, reason: 'Operator took the floor' },
            fill(copy.removedNotice, { name: participantLabel(participant) }),
        );

    const removeHand = (participant: ConsoleParticipant) =>
        runAction(
            `lower:${participant.id}`,
            { action: 'lower_hand', participantId: participant.id, reason: 'Removed from hand queue' },
            fill(copy.handLoweredNotice, { name: participantLabel(participant) }),
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
            fill(copy.trackMutedNotice, { track: track.source.toLowerCase() }),
        );

    const reconcile = () =>
        runAction(
            'reconcile',
            { action: 'reconcile' },
            copy.reconciliationFinished,
        );

    const all = snapshot?.participants ?? [];
    const onStage = all.filter((participant) => participant.stageState === 'ON_STAGE');
    const invited = all.filter(
        (participant) => participant.canPublish && participant.stageState !== 'ON_STAGE',
    );
    const queue = all
        .filter((participant) => participant.queuePosition !== null)
        .sort((left, right) => (left.queuePosition ?? 0) - (right.queuePosition ?? 0));
    const audience = all.filter(
        (participant) => !participant.canPublish && participant.queuePosition === null,
    );
    const reconcilePending = all.filter((participant) => participant.reconcileNeeded);
    const thumbnailFreshForSeconds = snapshot?.thumbnailFreshForSeconds ?? 10;

    return (
        <section className="space-y-6" aria-live="polite">
            {/* Status banners */}
            {pollError ? (
                <div role="alert" className="rounded border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-2 text-sm text-[var(--danger)]">
                    {fill(copy.pollingFailed, {
                        error: pollError,
                        seconds: POLL_INTERVAL_MS / 1000,
                    })}
                </div>
            ) : null}
            {snapshot && !snapshot.liveStateAvailable ? (
                <div role="alert" className="rounded border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-2 text-sm text-[var(--warning)]">
                    {copy.liveStateUnavailable}
                </div>
            ) : null}
            {reconcilePending.length > 0 ? (
                <div role="alert" className="rounded border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-2 text-sm text-[var(--warning)]">
                    {reconcilePending.length === 1
                        ? copy.reconciliationOne
                        : fill(copy.reconciliationMany, { count: reconcilePending.length })}
                </div>
            ) : null}
            {actionError ? (
                <div role="alert" className="rounded border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-2 text-sm text-[var(--danger)]">
                    {actionError.code === 'stage_full'
                        ? fill(copy.stageFull, { position: actionError.queuePosition ?? '?' })
                        : actionError.code === 'participant_not_connected'
                          ? actionError.message
                        : actionError.code === 'livekit_failed' && actionError.reconcileNeeded
                          ? fill(copy.livekitFailure, { message: actionError.message })
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
                    {fill(copy.stageSummary, {
                        active: snapshot?.activePublishers ?? '…',
                        max: snapshot?.maxPublishers ?? '…',
                    })}
                    {snapshot?.grantedPublishers !== undefined
                        ? ` · ${fill(copy.slotsReserved, {
                            granted: snapshot.grantedPublishers,
                            max: snapshot.maxPublishers,
                        })}`
                        : ''} ·{' '}
                    {fill(copy.handsRaised, { count: queue.length })}
                </span>
                <button
                    type="button"
                    onClick={() => void reconcile()}
                    disabled={busyKey === 'reconcile'}
                    className="min-h-11 rounded border border-[var(--border-subtle)] px-3 py-2 text-xs hover:bg-white/5 disabled:opacity-50"
                >
                    {copy.reconcile}
                </button>
            </div>

            {/* Hand queue comes first so a facilitator never has to hunt below the stage. */}
            <div>
                <h2 className="mb-1 text-lg font-semibold text-[var(--cream)]">{copy.handQueue}</h2>
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                    {fill(copy.handQueueHelp, { seconds: thumbnailFreshForSeconds })}
                </p>
                {queue.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">{copy.noHands}</p>
                ) : (
                    <ul className="space-y-2">
                        {queue.map((participant) => (
                            <li key={participant.id} className="operational-panel flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                                <div className="flex min-w-0 items-center gap-3">
                                    <HandThumbnail
                                        displayName={participant.displayName}
                                        src={participant.thumbnailUrl ?? null}
                                        freshForSeconds={thumbnailFreshForSeconds}
                                        copy={copy}
                                    />
                                    <div className="min-w-0">
                                        <span className="font-medium text-[var(--cream)]">#{participant.queuePosition} — {participantLabel(participant)}</span>
                                        <div className="text-xs text-[var(--text-secondary)]">
                                            {copy.waiting} {participant.raisedAt ? formatQueueAge(participant.raisedAt, nowMs) : '…'}
                                            {' · '}{connectionBadge(participant, copy)}
                                            {participant.connectionQuality ? ` · ${participant.connectionQuality.toLowerCase()} ${copy.quality}` : ''}
                                            {participant.reconcileNeeded ? ` · ${copy.reconcileNeeded}` : ''}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <button
                                        type="button"
                                        disabled={busyKey !== null || participant.connected !== true}
                                        onClick={() => void giveFloor(participant)}
                                        title={participant.connected === true ? undefined : copy.mustReconnect}
                                    className="min-h-11 rounded border border-[var(--lime)] px-3 py-2 text-xs text-[var(--lime)] hover:bg-[var(--lime)]/10 disabled:opacity-50"
                                    >
                                        {participant.connected === true ? copy.giveFloor : copy.waitingForReconnect}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busyKey !== null}
                                        onClick={() => void removeHand(participant)}
                                        className="min-h-11 rounded border border-[var(--border-subtle)] px-3 py-2 text-xs hover:bg-white/5 disabled:opacity-50"
                                    >
                                        {copy.removeHand}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div>
                <h2 className="mb-2 text-lg font-semibold text-[var(--cream)]">{copy.invitedHeading}</h2>
                {invited.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">{copy.noInvitations}</p>
                ) : (
                    <ul className="space-y-2">
                        {invited.map((participant) => (
                            <li key={participant.id} className="operational-panel flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <span className="font-medium text-[var(--cream)]">{participantLabel(participant)}</span>
                                    <div className="text-xs text-[var(--text-secondary)]">
                                        {participant.stageState === 'RECONNECTING'
                                            ? copy.inviteAfterReentry
                                            : participant.stageState === 'UNKNOWN'
                                              ? copy.unknownGrant
                                              : copy.awaitingAcceptance}
                                    </div>
                                </div>
                                {!participant.isAssignedFacilitator ? (
                                    <button type="button" disabled={busyKey !== null} onClick={() => void takeFloor(participant)} className="min-h-11 rounded border border-[var(--danger)] px-3 py-2 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50">
                                        {copy.cancelInvitation}
                                    </button>
                                ) : (
                                    <span className="text-xs font-medium text-[var(--text-muted)]">{copy.reservedFacilitator}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Stage */}
            <div>
                <h2 className="mb-2 text-lg font-semibold text-[var(--cream)]">{copy.onStage}</h2>
                {onStage.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">{copy.nobodyOnStage}</p>
                ) : (
                    <ul className="space-y-2">
                        {onStage.map((participant) => (
                            <li key={participant.id} className="operational-panel">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <span className="font-medium text-[var(--cream)]">{participantLabel(participant)}</span>
                                        {participant.staffRole ? (
                                            <span className="ml-2 text-[10px] uppercase text-[var(--text-muted)]">{roleLabel(participant.staffRole, staffRoles)}</span>
                                        ) : null}
                                        <div className="text-xs text-[var(--text-secondary)]">
                                            {connectionBadge(participant, copy)}
                                            {participant.connectionQuality ? ` · ${participant.connectionQuality.toLowerCase()} ${copy.quality}` : ''}
                                            {' · '}{mediaSummary(participant, copy)}
                                            {participant.reconcileNeeded ? ` · ${copy.reconcileNeeded}` : ''}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                                        {participant.media.map((track) => track.muted ? (
                                            <span key={track.trackSid} className="text-xs text-[var(--text-muted)]">
                                                {fill(copy.participantMustEnable, {
                                                    track: track.source.toLowerCase(),
                                                })}
                                            </span>
                                        ) : (
                                            <button
                                                key={track.trackSid}
                                                type="button"
                                                disabled={busyKey !== null}
                                                onClick={() => void muteTrack(participant, track)}
                                                className="min-h-11 rounded border border-[var(--border-subtle)] px-3 py-2 text-xs hover:bg-white/5 disabled:opacity-50"
                                            >
                                                {fill(copy.muteTrack, {
                                                    track: track.source.toLowerCase(),
                                                })}
                                            </button>
                                        ))}
                                        {!participant.isAssignedFacilitator ? (
                                            <button
                                                type="button"
                                                disabled={busyKey !== null}
                                                onClick={() => void takeFloor(participant)}
                                                className="min-h-11 rounded border border-[var(--danger)] px-3 py-2 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
                                            >
                                                {copy.takeFloor}
                                            </button>
                                        ) : (
                                            <span className="text-xs font-medium text-[var(--text-muted)]">
                                                {copy.reservedFacilitator}
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
                <h2 className="mb-2 text-lg font-semibold text-[var(--cream)]">
                    {fill(copy.audience, { count: audience.length })}
                </h2>
                {audience.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">{copy.noAudience}</p>
                ) : (
                    <ul className="space-y-1 text-sm">
                        {audience.map((participant) => (
                            <li key={participant.id} className="flex flex-col items-start justify-between gap-2 rounded px-2 py-1 sm:flex-row sm:items-center">
                                <span className="text-[var(--cream)]">
                                    {participantLabel(participant)}
                                    {participant.staffRole ? (
                                        <span className="ml-2 text-[10px] uppercase text-[var(--text-muted)]">{roleLabel(participant.staffRole, staffRoles)}</span>
                                    ) : null}
                                </span>
                                <span className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                                    <span>
                                        {connectionBadge(participant, copy)}
                                        {participant.connectionQuality ? ` · ${participant.connectionQuality.toLowerCase()}` : ''}
                                    </span>
                                    {participant.connected === true ? (
                                        <button
                                            type="button"
                                            disabled={busyKey !== null}
                                            onClick={() => void inviteToStage(participant)}
                                            className="min-h-11 rounded border border-[var(--lime)] px-3 py-2 text-xs text-[var(--lime)] hover:bg-[var(--lime)]/10 disabled:opacity-50"
                                        >
                                            {copy.inviteToStage}
                                        </button>
                                    ) : null}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <p className="text-xs text-[var(--text-muted)]">
                {fill(copy.footer, {
                    role: staffRoles[role],
                    seconds: POLL_INTERVAL_MS / 1000,
                })}
            </p>
        </section>
    );
}
