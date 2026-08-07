'use client';

import { useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdCopy } from '@/lib/early-birds/copy';

export default function WelcomeAccessAction() {
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const activationRequestId = useRef<string | null>(null);

    async function start() {
        if (busy) return;
        activationRequestId.current ??= crypto.randomUUID();
        setBusy(true);
        setError(false);
        try {
            const response = await fetch('/api/early-birds/welcome-access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activationRequestId: activationRequestId.current }),
            });
            if (response.ok) {
                window.location.reload();
                return;
            }
        } catch {}
        setBusy(false);
        setError(true);
    }

    return (
        <div className="listener-welcome-access">
            <button
                type="button"
                className="event-button event-button--primary w-full"
                disabled={busy}
                onClick={start}
            >
                {busy ? copy.welcomeStarting : copy.welcomeListen}
            </button>
            <p>{copy.welcomeDescription}</p>
            {error && <p role="alert" className="event-alert event-alert--error">{copy.welcomeError}</p>}
        </div>
    );
}
