'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

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
    const attempt = useRef<string | null>(null);

    const boundary = membership.serviceThrough
        ? new Intl.DateTimeFormat(locale === 'es' ? 'es-AR' : 'en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(membership.serviceThrough))
        : null;

    async function cancelMembership() {
        if (status === 'busy') return;
        setStatus('busy');
        const attemptId = attempt.current ?? crypto.randomUUID();
        attempt.current = attemptId;
        try {
            const response = await fetch('/api/listener/membership/cancel', {
                method: 'POST',
                cache: 'no-store',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ attemptId }),
            });
            const body = await response.json() as unknown;
            if (response.status !== 202 || !body || typeof body !== 'object' ||
                Array.isArray(body) || (body as Record<string, unknown>).status !== 'queued') {
                throw new Error();
            }
            setStatus('queued');
            setConfirming(false);
            window.setTimeout(() => router.refresh(), 2_000);
            window.setTimeout(() => router.refresh(), 8_000);
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
            {confirming && status !== 'queued' && (
                <div role="group" aria-label={copy.membershipCancelConfirmTitle}>
                    <p>{copy.membershipCancelConfirmDetail}</p>
                    <button type="button" disabled={status === 'busy'} onClick={() => void cancelMembership()}>
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
            {status === 'queued' && <p role="status">{copy.membershipCancelQueued}</p>}
            {status === 'failed' && <p role="alert">{copy.membershipCancelFailed}</p>}
        </div>
    );
}
