'use client';

/**
 * Attendee hand control for the paid room (WS3-02).
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

class HandRequestError extends Error {
    constructor(
        readonly status: number,
        readonly code: string | null,
    ) {
        super(code ?? `HTTP ${status}`);
        this.name = 'HandRequestError';
    }
}

async function handStateFrom(response: Response): Promise<OwnHandState> {
    const body = (await response.json().catch(() => ({}))) as Partial<OwnHandState> & {
        error?: unknown;
    };
    if (!response.ok) {
        throw new HandRequestError(
            response.status,
            typeof body.error === 'string' ? body.error : null,
        );
    }
    return body as OwnHandState;
}

function handFailureMessage(error: unknown, action: 'status' | 'raise' | 'lower'): string {
    if (error instanceof HandRequestError && error.status === 403) {
        if (error.code === 'Insufficient permissions') {
            return 'This browser is signed in as staff. Open the attendee in a private window or separate browser profile.';
        }
        return 'This attendee session is no longer authorized. Sign in again in a private window or separate browser profile.';
    }
    if (action === 'raise') return 'Could not raise hand';
    if (action === 'lower') return 'Could not lower hand';
    return 'Hand status unavailable';
}

export default function HandRaiseButton({ sessionId, onPublishGrantChange }: Props) {
    const [state, setState] = useState<OwnHandState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [authorizationBlocked, setAuthorizationBlocked] = useState(false);
    const mounted = useRef(true);
    const authorizationBlockedRef = useRef(false);
    const lastGrant = useRef<boolean | null>(null);

    const applyState = useCallback((next: OwnHandState) => {
        setState(next);
        if (lastGrant.current !== next.canPublish) {
            lastGrant.current = next.canPublish;
            onPublishGrantChange?.(next.canPublish);
        }
    }, [onPublishGrantChange]);

    const refresh = useCallback(async () => {
        if (authorizationBlockedRef.current) return;
        try {
            const response = await fetch(
                `/api/scheduled-sessions/${sessionId}/hand`,
                { cache: 'no-store' },
            );
            const next = await handStateFrom(response);
            if (mounted.current) {
                applyState(next);
                setError(null);
            }
        } catch (failure) {
            if (mounted.current) {
                const blocked = failure instanceof HandRequestError && failure.status === 403;
                authorizationBlockedRef.current = blocked;
                setAuthorizationBlocked(blocked);
                setError(handFailureMessage(failure, 'status'));
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
            applyState(await handStateFrom(response));
        } catch (failure) {
            const blocked = failure instanceof HandRequestError && failure.status === 403;
            authorizationBlockedRef.current = blocked;
            setAuthorizationBlocked(blocked);
            setError(handFailureMessage(failure, raised ? 'raise' : 'lower'));
        } finally {
            setBusy(false);
            void refresh();
        }
    }

    return (
        <div className="flex flex-col items-center gap-2">
            {!state?.canPublish ? (
                <button
                    type="button"
                    onClick={() => void setHand(!(state?.raised ?? false))}
                    disabled={busy || authorizationBlocked}
                    className={`rounded-full px-5 py-2.5 text-sm font-medium transition-all ${
                        state?.raised
                            ? 'bg-[var(--pink)] text-[var(--ink)] shadow-[0_0_16px_rgba(255,113,189,0.3)]'
                            : 'bg-white/10 text-[var(--text-muted)] hover:bg-white/20'
                    } disabled:opacity-50`}
                >
                    {state?.raised ? 'Lower hand / Bajar mano' : 'Raise hand / Levantar mano'}
                </button>
            ) : null}
            {state?.canPublish ? (
                <p role="status" className="text-xs text-[var(--lime)]">
                    You are on stage — enable mic and camera below.
                    <span className="mt-0.5 block opacity-80">Estás en escena — activá micrófono y cámara abajo.</span>
                </p>
            ) : state?.raised && state.queuePosition !== null ? (
                <p role="status" className="text-xs text-[var(--text-muted)]">
                    Hand raised — you are #{state.queuePosition} in the queue.
                    <span className="mt-0.5 block opacity-80">Mano levantada — sos #{state.queuePosition} en la fila.</span>
                </p>
            ) : null}
            {error ? (
                <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>
            ) : null}
        </div>
    );
}
