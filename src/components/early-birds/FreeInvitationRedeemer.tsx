'use client';

import { useState } from 'react';

import BrandLockup from '@/components/brand/BrandLockup';
import LanguageControl from '@/components/brand/LanguageControl';
import { useLocale } from '@/context/LocaleContext';

export default function FreeInvitationRedeemer() {
    const { locale } = useLocale();
    const copy = locale === 'es' ? {
        eyebrow: 'INVITACIÓN PERSONAL',
        heading: 'Activa tu acceso EarlyBird.',
        body: 'Esta invitación es individual y de un solo uso. Al activarla, tu cuenta recibirá el mismo acceso Listener que una membresía paga.',
        action: 'Activar invitación',
        activating: 'Activando…',
        error: 'Esta invitación no está disponible. Si crees que es un error, contacta a soporte.',
    } : {
        eyebrow: 'PERSONAL INVITATION',
        heading: 'Activate your EarlyBird access.',
        body: 'This invitation is individual and can be used once. Activating it gives your account the same Listener access as a paid membership.',
        action: 'Activate invitation',
        activating: 'Activating…',
        error: 'This invitation is unavailable. Contact support if you believe this is a mistake.',
    };
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);

    async function redeem() {
        if (busy) return;
        setBusy(true);
        setError(false);
        try {
            const response = await fetch('/api/early-birds/free/redeem', {
                method: 'POST',
            });
            if (response.ok) {
                window.location.assign('/early-birds');
                return;
            }
        } catch {}
        setBusy(false);
        setError(true);
    }

    return (
        <main className="event-shell">
            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-8 px-6 py-12">
                <header className="flex items-center justify-between gap-4">
                    <BrandLockup href="/early-birds" />
                    <LanguageControl />
                </header>
                <section className="space-y-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-7 shadow-[var(--shadow-deep)]">
                    <p className="font-mono text-xs tracking-[0.22em] text-[var(--gold)]">{copy.eyebrow}</p>
                    <h1 className="font-serif text-4xl font-normal leading-tight">{copy.heading}</h1>
                    <p className="text-sm leading-6 text-[var(--text-secondary)]">{copy.body}</p>
                    {error && <p role="alert" className="event-alert event-alert--danger">{copy.error}</p>}
                    <button
                        type="button"
                        disabled={busy}
                        onClick={redeem}
                        className="event-button event-button--primary w-full"
                    >
                        {busy ? copy.activating : copy.action}
                    </button>
                </section>
            </div>
        </main>
    );
}
