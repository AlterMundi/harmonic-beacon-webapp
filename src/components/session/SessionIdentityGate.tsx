'use client';

import { useEffect, useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';

type Props = {
    sessionId: string;
    sessionTitle: string;
    initialDisplayName: string;
    onConfirmed: (displayName: string) => void;
};

export default function SessionIdentityGate({
    sessionId,
    sessionTitle,
    initialDisplayName,
    onConfirmed,
}: Props) {
    const { copy } = useLocale();
    const [displayName, setDisplayName] = useState(initialDisplayName);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setDisplayName(initialDisplayName);
        setError(null);
    }, [initialDisplayName, sessionId]);

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        if (!displayName.trim()) {
            setError(copy.session.nameConfirmationRequired);
            inputRef.current?.focus();
            return;
        }

        setBusy(true);
        setError(null);
        try {
            const response = await fetch(`/api/scheduled-sessions/${sessionId}/entry`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName }),
            });
            const body = await response.json().catch(() => ({})) as {
                displayName?: unknown;
                error?: unknown;
            };
            if (!response.ok || typeof body.displayName !== 'string') {
                if (response.status === 400) {
                    setError(copy.session.nameConfirmationRequired);
                    inputRef.current?.focus();
                } else {
                    setError(copy.session.nameConfirmationFailed);
                }
                return;
            }
            onConfirmed(body.displayName);
        } catch {
            setError(copy.session.nameConfirmationFailed);
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="event-shell">
            <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
                <form
                    className="event-card w-full max-w-md space-y-5"
                    onSubmit={(event) => void submit(event)}
                    noValidate
                >
                    <header className="space-y-2">
                        <p className="hb-section-label">{copy.session.nameConfirmationEyebrow}</p>
                        <h1 className="font-serif text-3xl font-normal text-[var(--paper)]">
                            {copy.session.nameConfirmationHeading}
                        </h1>
                        <p className="text-sm leading-6 text-[var(--text-secondary)]">
                            {copy.session.nameConfirmationBody}
                        </p>
                        <p className="text-xs text-[var(--gold)]">{sessionTitle}</p>
                    </header>

                    <div className="space-y-1.5">
                        <label htmlFor="session-display-name" className="block text-sm font-medium text-[var(--paper)]">
                            {copy.session.nameConfirmationLabel}
                        </label>
                        <input
                            ref={inputRef}
                            id="session-display-name"
                            name="displayName"
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                            required
                            maxLength={60}
                            autoComplete="name"
                            autoFocus
                            aria-describedby="session-display-name-hint"
                            className="event-field"
                        />
                        <p id="session-display-name-hint" className="text-xs leading-5 text-[var(--text-muted)]">
                            {copy.session.nameConfirmationHint}
                        </p>
                    </div>

                    {error ? (
                        <p role="alert" className="event-alert event-alert--danger">{error}</p>
                    ) : null}

                    <button
                        type="submit"
                        disabled={busy}
                        aria-busy={busy}
                        className="event-button event-button--primary w-full"
                    >
                        {busy
                            ? copy.session.nameConfirmationSaving
                            : copy.session.nameConfirmationAction}
                    </button>
                    <p className="text-xs leading-5 text-[var(--text-muted)]">
                        {copy.session.nameConfirmationPrivacy}
                    </p>
                </form>
            </div>
        </main>
    );
}
