'use client';

/**
 * Attendee hand control for the paid room (WS3-02).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';
import type { Messages } from '@/lib/i18n';

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
    stageInvitationAccepted?: boolean;
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

function handFailureMessage(
    error: unknown,
    action: 'status' | 'raise' | 'lower',
    copy: Messages['hand'],
): string {
    if (error instanceof HandRequestError && error.status === 403) {
        if (error.code === 'Insufficient permissions') {
            return copy.staffCollision;
        }
        return copy.unauthorized;
    }
    if (action === 'raise') return copy.raiseFailed;
    if (action === 'lower') return copy.lowerFailed;
    return copy.statusUnavailable;
}

export default function HandRaiseButton({
    sessionId,
    onPublishGrantChange,
    stageInvitationAccepted = false,
}: Props) {
    const { copy } = useLocale();
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
                setError(handFailureMessage(failure, 'status', copy.hand));
            }
        }
    }, [sessionId, applyState, copy.hand]);

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
            setError(handFailureMessage(failure, raised ? 'raise' : 'lower', copy.hand));
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
                    {state?.raised ? copy.hand.lower : copy.hand.raise}
                </button>
            ) : null}
            {!state?.canPublish ? (
                <p className="max-w-xs text-center text-xs leading-4 text-[var(--text-muted)]">
                    {copy.hand.namingConsent}
                </p>
            ) : null}
            {state?.canPublish && stageInvitationAccepted ? (
                <p role="status" className="text-xs text-[var(--lime)]">
                    {copy.hand.onStage}
                </p>
            ) : state?.raised && state.queuePosition !== null ? (
                <p role="status" className="text-xs text-[var(--text-muted)]">
                    {copy.hand.queuedPrefix} #{state.queuePosition} {copy.hand.queuedSuffix}
                </p>
            ) : null}
            {error ? (
                <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>
            ) : null}
        </div>
    );
}
