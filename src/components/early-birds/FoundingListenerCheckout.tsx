'use client';

import { useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdCopy } from '@/lib/early-birds/copy';
import type { ListenerCheckoutProvider } from '@/lib/early-birds/checkout';

type Availability = { paypal: boolean; mercadoPago: boolean };

export default function FoundingListenerCheckout({
    available,
    environment = 'staging',
}: {
    available: Availability;
    environment?: 'staging' | 'live';
}) {
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const [busy, setBusy] = useState<ListenerCheckoutProvider | null>(null);
    const [failed, setFailed] = useState(false);
    const attempts = useRef<Partial<Record<ListenerCheckoutProvider, string>>>({});

    if (!available.paypal && !available.mercadoPago) return null;

    async function start(provider: ListenerCheckoutProvider) {
        if (busy) return;
        setBusy(provider);
        setFailed(false);
        const attemptId = attempts.current[provider] ?? crypto.randomUUID();
        attempts.current[provider] = attemptId;
        try {
            const response = await fetch('/api/listener/checkout', {
                method: 'POST',
                cache: 'no-store',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, attemptId }),
            });
            const result = await response.json() as unknown;
            if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
            const body = result as Record<string, unknown>;
            if (body.provider !== provider || typeof body.approvalUrl !== 'string') throw new Error();
            const target = new URL(body.approvalUrl);
            if (target.protocol !== 'https:') throw new Error();
            window.location.assign(target.toString());
            return;
        } catch {
            setFailed(true);
        }
        setBusy(null);
    }

    return (
        <details className="listener-checkout">
            <summary>{copy.freeQuotaMembershipCta}</summary>
            <div className="listener-checkout__options">
                <strong>{environment === 'live' ? copy.checkoutLiveTitle : copy.checkoutSandboxTitle}</strong>
                <p>{environment === 'live' ? copy.checkoutLiveDetail : copy.checkoutSandboxDetail}</p>
                {environment === 'live' && (
                    <p className="listener-checkout__legal">
                        {copy.checkoutAgreement}{' '}
                        <a href="/listener/terms">{copy.checkoutTerms}</a>{' · '}
                        <a href="/listener/privacy">{copy.checkoutPrivacy}</a>
                    </p>
                )}
                {available.paypal && (
                    <button
                        type="button"
                        className="listener-button listener-button--secondary w-full"
                        disabled={busy !== null}
                        onClick={() => void start('paypal')}
                    >
                        {busy === 'paypal' ? copy.checkoutOpening : copy.checkoutPayPal}
                    </button>
                )}
                {available.mercadoPago && (
                    <button
                        type="button"
                        className="listener-button listener-button--secondary w-full"
                        disabled={busy !== null}
                        onClick={() => void start('mercado_pago')}
                    >
                        {busy === 'mercado_pago' ? copy.checkoutOpening : copy.checkoutMercadoPago}
                    </button>
                )}
                {failed && <p role="alert">{environment === 'live'
                    ? copy.checkoutLiveUnavailable
                    : copy.checkoutUnavailable}</p>}
            </div>
        </details>
    );
}
