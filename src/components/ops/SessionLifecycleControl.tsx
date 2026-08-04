'use client';

import { useEffect, useMemo, useState } from 'react';
import type { StaffRole } from '@prisma/client';
import type { Messages, UiLocale } from '@/lib/i18n';
import { hasStaffCapability } from '@/lib/staff-capabilities';

type Props = {
    sessionId: string;
    initialStatus: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
    scheduledAt: string;
    role: StaffRole;
    locale: UiLocale;
    copy: Messages['ops']['lifecycle'];
    observedStatus?: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
    onStatusChange?: (status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED') => void;
};

const EARLY_MS = 10 * 60 * 1000;
const LATE_MS = 60 * 60 * 1000;

export default function SessionLifecycleControl({
    sessionId,
    initialStatus,
    scheduledAt,
    role,
    locale,
    copy,
    observedStatus,
    onStatusChange,
}: Props) {
    const [status, setStatus] = useState(initialStatus);
    const [confirmClose, setConfirmClose] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => setNowMs(Date.now()), 30_000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!observedStatus || observedStatus === status) return;
        setStatus(observedStatus);
        setConfirmClose(false);
        setNotice(null);
        setError(null);
    }, [observedStatus, status]);

    const outsideOpenWindow = useMemo(() => {
        const start = new Date(scheduledAt).getTime();
        return nowMs < start - EARLY_MS || nowMs > start + LATE_MS;
    }, [scheduledAt, nowMs]);
    const canOverrideWindow = hasStaffCapability(role, 'administer_system');

    function connectionOutcome(template: string, stage: number, beacon: number): string {
        return template
            .replace('{stage}', String(stage))
            .replace('{beacon}', String(beacon));
    }

    async function transition(targetStatus: 'LIVE' | 'ENDED' | 'CANCELLED') {
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const response = await fetch(`/api/ops/sessions/${sessionId}/lifecycle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: targetStatus,
                    ...(reason.trim() ? { reason: reason.trim() } : {}),
                }),
            });
            const data = await response.json().catch(() => ({})) as {
                status?: string;
                message?: string;
                changed?: boolean;
                termination?: {
                    complete: boolean;
                    stageDisconnected: number;
                    bedDisconnected: number;
                };
            };
            if (!response.ok) {
                throw new Error(`${copy.statusChangeFailed} (HTTP ${response.status})`);
            }
            const nextStatus = (data.status as typeof status) || targetStatus;
            setStatus(nextStatus);
            onStatusChange?.(nextStatus);
            setConfirmClose(false);
            setReason('');
            if (targetStatus === 'LIVE') {
                setNotice(data.changed === false
                    ? copy.doorsAlreadyOpen
                    : copy.doorsOpened);
            } else if (data.termination?.complete) {
                setNotice(
                    connectionOutcome(
                        targetStatus === 'CANCELLED' ? copy.eventCancelled : copy.eventEnded,
                        data.termination.stageDisconnected,
                        data.termination.bedDisconnected,
                    ),
                );
            } else {
                setError(copy.disconnectIncomplete);
            }
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : copy.statusChangeFailed);
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="operational-panel mb-6" aria-labelledby="event-lifecycle-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 id="event-lifecycle-heading" className="font-semibold text-[var(--cream)]">
                        {copy.heading}
                    </h2>
                    <p className="text-xs text-[var(--text-secondary)]">
                        {copy.status}: <strong>{copy.statuses[status]}</strong> · {copy.scheduled}{' '}
                        {new Date(scheduledAt).toLocaleString(locale === 'es' ? 'es-AR' : 'en-GB')}
                    </p>
                </div>
                {status === 'SCHEDULED' ? (
                    <button
                        type="button"
                        disabled={busy ||
                            (outsideOpenWindow && !canOverrideWindow) ||
                            (outsideOpenWindow && canOverrideWindow && !reason.trim())}
                        onClick={() => void transition('LIVE')}
                        className="event-button event-button--primary"
                    >
                        {busy ? copy.opening : copy.openDoors}
                    </button>
                ) : status === 'LIVE' ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmClose(true)}
                        className="event-button event-button--secondary"
                    >
                        {copy.closeEvent}
                    </button>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs text-[var(--text-muted)]">
                            {copy.statuses[status]}
                        </span>
                        {status === 'ENDED' || canOverrideWindow ? (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmClose(true)}
                                className="event-button event-button--secondary"
                            >
                                {copy.disconnectRemaining}
                            </button>
                        ) : null}
                    </div>
                )}
            </div>

            {status === 'SCHEDULED' && outsideOpenWindow ? (
                <div className="mt-3 space-y-2">
                    <p className="text-xs text-[var(--warning)]">
                        {canOverrideWindow
                            ? copy.outsideWindowOverride
                            : copy.outsideWindowRestricted}
                    </p>
                    {canOverrideWindow ? (
                        <label className="block text-xs text-[var(--text-secondary)]">
                            {copy.reasonLabel}
                            <input
                                value={reason}
                                maxLength={240}
                                onChange={(event) => setReason(event.target.value)}
                                className="event-field mt-1 w-full"
                            />
                        </label>
                    ) : null}
                </div>
            ) : null}

            {confirmClose ? (
                <div role="alertdialog" aria-labelledby="close-event-heading" className="mt-3 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3">
                    <h3 id="close-event-heading" className="font-medium text-[var(--cream)]">{copy.confirmHeading}</h3>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {copy.confirmBody}
                    </p>
                    <div className="mt-3 flex gap-2">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => void transition(status === 'CANCELLED' ? 'CANCELLED' : 'ENDED')}
                            className="event-button event-button--primary"
                        >
                            {busy ? copy.disconnecting : copy.endAndDisconnect}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmClose(false)}
                            className="event-button event-button--secondary"
                        >
                            {copy.keepOpen}
                        </button>
                    </div>
                </div>
            ) : null}
            {notice ? <p role="status" className="mt-3 text-xs text-[var(--lime)]">{notice}</p> : null}
            {error ? <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{error}</p> : null}
        </section>
    );
}
