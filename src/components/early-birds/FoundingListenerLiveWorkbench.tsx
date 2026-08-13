'use client';

import { useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';
import type { ListenerCheckoutProvider } from '@/lib/early-birds/checkout';
import { earlyBirdCopy } from '@/lib/early-birds/copy';

const CSRF_HEADER = 'x-hb-listener-live-csrf';

export type ListenerLiveWorkbenchClientConfig = {
    provider: ListenerCheckoutProvider;
    csrfToken: string;
};

export default function FoundingListenerLiveWorkbench({
    config,
}: {
    config: ListenerLiveWorkbenchClientConfig | null;
}) {
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const attemptId = useRef<string | null>(null);

    if (!config) return null;

    async function start() {
        if (busy || !config) return;
        setBusy(true);
        setFailed(false);
        attemptId.current ??= crypto.randomUUID();
        try {
            const response = await fetch('/api/listener/checkout/live-workbench', {
                method: 'POST',
                cache: 'no-store',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    [CSRF_HEADER]: config.csrfToken,
                },
                body: JSON.stringify({ attemptId: attemptId.current }),
            });
            const result = await response.json() as unknown;
            if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result)) {
                throw new Error();
            }
            const body = result as Record<string, unknown>;
            if (body.provider !== config.provider || typeof body.approvalUrl !== 'string') {
                throw new Error();
            }
            const target = new URL(body.approvalUrl);
            if (target.protocol !== 'https:') throw new Error();
            window.location.assign(target.toString());
            return;
        } catch {
            setFailed(true);
        }
        setBusy(false);
    }

    return (
        <details className="listener-checkout" data-listener-live-workbench="private">
            <summary>{copy.freeQuotaMembershipCta}</summary>
            <div className="listener-checkout__options">
                <strong>{copy.checkoutLiveTitle}</strong>
                <p>{copy.checkoutLiveDetail}</p>
                <p className="listener-checkout__legal">
                    {copy.checkoutAgreement}{' '}
                    <a href="/listener/terms">{copy.checkoutTerms}</a>{' · '}
                    <a href="/listener/privacy">{copy.checkoutPrivacy}</a>
                </p>
                <button
                    type="button"
                    className="listener-button listener-button--secondary w-full"
                    disabled={busy}
                    onClick={() => void start()}
                >
                    {busy
                        ? copy.checkoutOpening
                        : config.provider === 'paypal'
                            ? copy.checkoutPayPal
                            : copy.checkoutMercadoPago}
                </button>
                {failed && <p role="alert">{copy.checkoutLiveUnavailable}</p>}
            </div>
        </details>
    );
}
