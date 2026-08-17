'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdCopy } from '@/lib/early-birds/copy';
import type { ListenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';

export default function FoundingListenerMembershipActions({
    membership,
}: {
    membership: Extract<ListenerMembershipPresentation, { kind: 'founder' }>;
}) {
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const router = useRouter();
    const [confirming, setConfirming] = useState(false);
    const [status, setStatus] = useState<'idle' | 'busy' | 'queued' | 'failed'>('idle');
    const [action, setAction] = useState<'cancel' | 'reactivate' | null>(null);
    const attempt = useRef<{ action: 'cancel' | 'reactivate'; id: string } | null>(null);
    const refreshTimers = useRef<number[]>([]);

    function clearRefreshTimers() {
        for (const timer of refreshTimers.current) window.clearTimeout(timer);
        refreshTimers.current = [];
    }

    useEffect(() => () => {
        clearRefreshTimers();
    }, []);

    useEffect(() => {
        const canonicalActionCompleted = status === 'queued' && (
            (action === 'cancel' && membership.state === 'ending')
            || (action === 'reactivate' && membership.state === 'active')
        );
        if (!canonicalActionCompleted) return;
        clearRefreshTimers();
        attempt.current = null;
        setAction(null);
        setStatus('idle');
    }, [action, membership.state, status]);

    const boundary = membership.serviceThrough
        ? new Intl.DateTimeFormat(locale === 'es' ? 'es-AR' : 'en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC',
            timeZoneName: 'short',
        }).format(new Date(membership.serviceThrough))
        : null;

    async function requestMembershipAction(requestedAction: 'cancel' | 'reactivate') {
        if (status === 'busy') return;
        setStatus('busy');
        setAction(requestedAction);
        const attemptId = attempt.current?.action === requestedAction
            ? attempt.current.id
            : crypto.randomUUID();
        attempt.current = { action: requestedAction, id: attemptId };
        try {
            const response = await fetch('/api/listener/membership/action', {
                method: 'POST',
                cache: 'no-store',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: requestedAction, attemptId }),
            });
            const body = await response.json() as unknown;
            if (response.status !== 202 || !body || typeof body !== 'object' ||
                Array.isArray(body) || (body as Record<string, unknown>).status !== 'queued') {
                throw new Error();
            }
            setStatus('queued');
            setConfirming(false);
            clearRefreshTimers();
            refreshTimers.current = [2_000, 5_000, 10_000, 20_000, 40_000, 60_000, 90_000, 120_000]
                .map((delay) => window.setTimeout(() => router.refresh(), delay));
        } catch {
            setStatus('failed');
        }
    }

    return (
        <div className="listener-membership-actions">
            {boundary && (
                <small>{membership.state === 'ending'
                    ? copy.membershipAccessThrough.replace('{date}', boundary)
                    : copy.membershipCurrentPeriodThrough.replace('{date}', boundary)}</small>
            )}
            {membership.state !== 'ending' && status !== 'queued' && !confirming && (
                <button type="button" onClick={() => setConfirming(true)}>
                    {copy.membershipCancel}
                </button>
            )}
            {membership.state === 'ending' && status !== 'queued' && (
                <button
                    type="button"
                    disabled={status === 'busy'}
                    onClick={() => void requestMembershipAction('reactivate')}
                >
                    {status === 'busy' && action === 'reactivate'
                        ? copy.membershipReactivateWorking
                        : copy.membershipReactivate}
                </button>
            )}
            {confirming && status !== 'queued' && (
                <div role="group" aria-label={copy.membershipCancelConfirmTitle}>
                    <p>{copy.membershipCancelConfirmDetail}</p>
                    <button type="button" disabled={status === 'busy'} onClick={() => void requestMembershipAction('cancel')}>
                        {status === 'busy' ? copy.membershipCancelWorking : copy.membershipCancelConfirm}
                    </button>
                    <button type="button" disabled={status === 'busy'} onClick={() => {
                        setConfirming(false);
                        setStatus('idle');
                    }}>
                        {copy.membershipKeep}
                    </button>
                </div>
            )}
            {status === 'queued' && <p role="status">{action === 'reactivate'
                ? copy.membershipReactivateQueued
                : copy.membershipCancelQueued}</p>}
            {status === 'failed' && <p role="alert">{action === 'reactivate'
                ? copy.membershipReactivateFailed
                : copy.membershipCancelFailed}</p>}
        </div>
    );
}
