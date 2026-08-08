'use client';

import { useState, type FormEvent } from 'react';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdSyntheticEntryCopy } from '@/lib/early-birds/copy';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

export default function SyntheticTeamEntryForm({
    authOnly = false,
    postLoginPath = LISTENER_NAMESPACE.canonical.home,
}: {
    authOnly?: boolean;
    postLoginPath?: string;
}) {
    const { locale } = useLocale();
    const copy = earlyBirdSyntheticEntryCopy[locale];
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [accessCode, setAccessCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !accessCode) return;
        setBusy(true);
        setFailed(false);

        // Keep the staging credential in component memory only, and clear it
        // immediately after constructing the one authenticated request.
        const bearer = accessCode;
        setAccessCode('');
        try {
            const response = await fetch('/api/early-birds/test-login', {
                method: 'POST',
                cache: 'no-store',
                headers: {
                    authorization: `Bearer ${bearer}`,
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ name, email, authOnly }),
            });
            if (!response.ok) throw new Error('synthetic entry unavailable');
            window.location.assign(postLoginPath);
        } catch {
            setBusy(false);
            setFailed(true);
        }
    }

    return (
        <form onSubmit={submit} className="mt-6 space-y-3 border-t border-[var(--border-subtle)] pt-5">
            <div>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--gold)]">{copy.title}</p>
                <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{copy.description}</p>
            </div>
            <label className="block text-xs text-[var(--text-secondary)]">
                {copy.name}
                <input
                    type="text"
                    required
                    minLength={1}
                    maxLength={80}
                    autoComplete="off"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="listener-input mt-1"
                />
            </label>
            <label className="block text-xs text-[var(--text-secondary)]">
                {copy.email}
                <input
                    type="email"
                    required
                    maxLength={92}
                    pattern="[A-Za-z0-9._-]+@e2e\.invalid"
                    autoComplete="off"
                    placeholder="name@e2e.invalid"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="listener-input mt-1"
                />
            </label>
            <label className="block text-xs text-[var(--text-secondary)]">
                {copy.accessCode}
                <input
                    type="password"
                    required
                    minLength={32}
                    maxLength={512}
                    autoComplete="off"
                    value={accessCode}
                    onChange={(event) => setAccessCode(event.target.value)}
                    className="listener-input mt-1"
                />
            </label>
            {failed && <p role="alert" className="listener-alert listener-alert--danger">{copy.failed}</p>}
            <button type="submit" disabled={busy} className="listener-button listener-button--ghost w-full">
                {busy ? copy.entering : copy.enter}
            </button>
        </form>
    );
}
