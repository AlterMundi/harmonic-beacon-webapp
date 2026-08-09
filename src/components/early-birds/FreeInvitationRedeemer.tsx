'use client';

import { useState } from 'react';

import BrandLockup from '@/components/brand/BrandLockup';
import { useLocale } from '@/context/LocaleContext';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

export default function FreeInvitationRedeemer() {
    const { locale } = useLocale();
    const copy = locale === 'es' ? {
        eyebrow: 'HARMONIC BEACON · LISTENER',
        heading: 'Activa tu invitación Listener.',
        body: 'Esta invitación es individual y de un solo uso. Al activarla, tu cuenta recibirá acceso Listener por invitación; no crea una compra ni una membresía paga.',
        action: 'Activar invitación',
        activating: 'Activando…',
        error: 'Esta invitación no está disponible. Si crees que es un error, contacta a soporte.',
    } : {
        eyebrow: 'HARMONIC BEACON · LISTENER',
        heading: 'Activate your Listener invitation.',
        body: 'This invitation is individual and can be used once. Activating it grants invitation access; it does not create a purchase or paid membership.',
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
            const response = await fetch(LISTENER_NAMESPACE.canonical.api.freeRedeem, {
                method: 'POST',
            });
            if (response.ok) {
                window.location.assign(LISTENER_NAMESPACE.canonical.home);
                return;
            }
        } catch {}
        setBusy(false);
        setError(true);
    }

    return (
        <main className="listener-page-shell">
            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-8 px-6 py-12">
                <header className="flex items-center justify-between gap-4">
                    <BrandLockup href={LISTENER_NAMESPACE.publicWebsite} />
                </header>
                <section className="space-y-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-7 shadow-[var(--shadow-deep)]">
                    <p className="font-mono text-xs tracking-[0.22em] text-[var(--gold)]">{copy.eyebrow}</p>
                    <h1 className="font-serif text-4xl font-normal leading-tight">{copy.heading}</h1>
                    <p className="text-sm leading-6 text-[var(--text-secondary)]">{copy.body}</p>
                    {error && <p role="alert" className="listener-alert listener-alert--danger">{copy.error}</p>}
                    <button
                        type="button"
                        disabled={busy}
                        onClick={redeem}
                        className="listener-button listener-button--primary w-full"
                    >
                        {busy ? copy.activating : copy.action}
                    </button>
                </section>
            </div>
        </main>
    );
}
