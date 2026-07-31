'use client';

import { useEffect, useMemo, useState } from 'react';

type Props = {
    sessionId: string;
    initialStatus: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
    scheduledAt: string;
    role: string;
};

const EARLY_MS = 10 * 60 * 1000;
const LATE_MS = 60 * 60 * 1000;

export default function SessionLifecycleControl({
    sessionId,
    initialStatus,
    scheduledAt,
    role,
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

    const outsideOpenWindow = useMemo(() => {
        const start = new Date(scheduledAt).getTime();
        return nowMs < start - EARLY_MS || nowMs > start + LATE_MS;
    }, [scheduledAt, nowMs]);
    const canOverrideWindow = role === 'ADMIN';

    async function transition(targetStatus: 'LIVE' | 'ENDED') {
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
            };
            if (!response.ok) {
                throw new Error(data.message || `Status change failed (HTTP ${response.status})`);
            }
            setStatus((data.status as typeof status) || targetStatus);
            setConfirmClose(false);
            setReason('');
            setNotice(targetStatus === 'LIVE'
                ? (data.changed === false ? 'Doors were already open.' : 'Doors are open. Attendees are entering now.')
                : (data.changed === false ? 'Event was already closed.' : 'Event closed. Connected attendees will see the closing state.'));
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Status change failed');
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="operational-panel mb-6" aria-labelledby="event-lifecycle-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 id="event-lifecycle-heading" className="font-semibold text-[var(--cream)]">
                        Event doors
                    </h2>
                    <p className="text-xs text-[var(--text-secondary)]">
                        Status: <strong>{status}</strong> · scheduled{' '}
                        {new Date(scheduledAt).toLocaleString()}
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
                        {busy ? 'Opening…' : 'Open doors'}
                    </button>
                ) : status === 'LIVE' ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmClose(true)}
                        className="event-button event-button--secondary"
                    >
                        Close event
                    </button>
                ) : (
                    <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs text-[var(--text-muted)]">
                        {status === 'ENDED' ? 'Event closed' : 'Event cancelled'}
                    </span>
                )}
            </div>

            {status === 'SCHEDULED' && outsideOpenWindow ? (
                <div className="mt-3 space-y-2">
                    <p className="text-xs text-[var(--warning)]">
                        {canOverrideWindow
                            ? 'This is outside the normal opening window. An audit reason is required.'
                            : 'Doors can open from 10 minutes before until 60 minutes after the scheduled start.'}
                    </p>
                    {canOverrideWindow ? (
                        <label className="block text-xs text-[var(--text-secondary)]">
                            Operational reason (do not include attendee details)
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
                    <h3 id="close-event-heading" className="font-medium text-[var(--cream)]">Close this event?</h3>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        New tokens will stop immediately. Connected attendees will move to the closing state on their next status check.
                    </p>
                    <div className="mt-3 flex gap-2">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => void transition('ENDED')}
                            className="event-button event-button--primary"
                        >
                            {busy ? 'Closing…' : 'Confirm close'}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmClose(false)}
                            className="event-button event-button--secondary"
                        >
                            Keep open
                        </button>
                    </div>
                </div>
            ) : null}
            {notice ? <p role="status" className="mt-3 text-xs text-[var(--lime)]">{notice}</p> : null}
            {error ? <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{error}</p> : null}
        </section>
    );
}
