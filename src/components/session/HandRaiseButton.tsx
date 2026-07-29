'use client';

/**
 * Attendee hand control for the paid room (WS3-02).
 *
 * Polls the attendee hand endpoint every two seconds — the same
 * database-backed state the operator console sees — so a promotion granted
 * while the room page is open shows up here without a reconnect. When the
 * durable grant flips, `onPublishGrantChange` lets the room page reveal the
 * mic/camera controls; the devices themselves still need an explicit gesture,
 * which is the roadmap's "a promoted participant must explicitly enable
 * microphone/camera after the grant".
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 2_000;

type OwnHandState = {
    participantId: string;
    raised: boolean;
    raisedAt: string | null;
    queuePosition: number | null;
    canPublish: boolean;
};

type Props = {
    sessionId: string;
    onPublishGrantChange?: (canPublish: boolean) => void;
};

export default function HandRaiseButton({ sessionId, onPublishGrantChange }: Props) {
    const [state, setState] = useState<OwnHandState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const mounted = useRef(true);
    const lastGrant = useRef<boolean | null>(null);

    const applyState = useCallback((next: OwnHandState) => {
        setState(next);
        if (lastGrant.current !== next.canPublish) {
            lastGrant.current = next.canPublish;
            onPublishGrantChange?.(next.canPublish);
        }
    }, [onPublishGrantChange]);

    const refresh = useCallback(async () => {
        try {
            const response = await fetch(
                `/api/scheduled-sessions/${sessionId}/hand`,
                { cache: 'no-store' },
            );
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            if (mounted.current) {
                applyState((await response.json()) as OwnHandState);
                setError(null);
            }
        } catch {
            if (mounted.current) {
                setError('Hand status unavailable');
            }
        }
    }, [sessionId, applyState]);

    useEffect(() => {
        mounted.current = true;
        void refresh();
        const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
        return () => {
            mounted.current = false;
            clearInterval(timer);
        };
    }, [refresh]);

    async function setHand(raised: boolean) {
        setBusy(true);
        setError(null);
        try {
            const response = await fetch(
                `/api/scheduled-sessions/${sessionId}/hand`,
                { method: raised ? 'POST' : 'DELETE' },
            );
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            applyState((await response.json()) as OwnHandState);
        } catch {
            setError(raised ? 'Could not raise hand' : 'Could not lower hand');
        } finally {
            setBusy(false);
            void refresh();
        }
    }

    return (
        <div className="flex flex-col items-center gap-2">
            <button
                type="button"
                onClick={() => void setHand(!(state?.raised ?? false))}
                disabled={busy}
                className={`rounded-full px-4 py-2 text-sm transition-all ${
                    state?.raised
                        ? 'bg-[var(--primary-600)] text-white'
                        : 'bg-white/10 text-[var(--text-muted)] hover:bg-white/20'
                } disabled:opacity-50`}
            >
                {state?.raised ? 'Lower hand' : 'Raise hand'}
            </button>
            {state?.canPublish ? (
                <p role="status" className="text-xs text-[var(--primary-400)]">
                    Your turn — enable mic and camera below.
                </p>
            ) : state?.raised && state.queuePosition !== null ? (
                <p role="status" className="text-xs text-[var(--text-muted)]">
                    Hand raised — you are #{state.queuePosition} in the queue.
                </p>
            ) : null}
            {error ? (
                <p role="alert" className="text-xs text-red-400">{error}</p>
            ) : null}
        </div>
    );
}
