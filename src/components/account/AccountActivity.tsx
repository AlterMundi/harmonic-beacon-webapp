'use client';

import { useEffect, useState } from 'react';

export type AccountHome = {
    identityKey: string;
    listenerOrigin: 'https://listen.harmonicbeacon.com' | 'https://earlybirds-staging.harmonicbeacon.com';
};
type Summary = {
    listeningSeconds: number | null;
    membership: { kind: 'none' | 'invitation' | 'preview' | 'founder' | 'paid-status' | 'unknown'; state: string };
};
type Phase = 'loading' | 'ready' | 'connect' | 'unavailable';
const MEMBERSHIPS = ['none', 'invitation', 'preview', 'founder', 'paid-status', 'unknown'];
const STATES = ['none', 'pending', 'active', 'grace', 'ending', 'expired', 'refunded', 'revoked', 'unknown'];

export function AccountListeningCard({ home, locale }: { home: AccountHome; locale: 'es' | 'en' }) {
    const es = locale === 'es';
    const { identityKey, listenerOrigin } = home;
    const key = `${listenerOrigin}:${identityKey}`;
    const [snapshot, setSnapshot] = useState<{ key: string; phase: Phase; summary?: Summary }>({ key, phase: 'loading' });
    const [retry, setRetry] = useState(0);
    const current = snapshot.key === key ? snapshot : { phase: 'loading' as Phase, summary: undefined };
    useEffect(() => {
        const controller = new AbortController();
        const save = (phase: Phase, summary?: Summary) => setSnapshot({ key, phase, summary });
        const timeout = setTimeout(() => { controller.abort(); save('unavailable'); }, 10_000);
        void fetch(`${listenerOrigin}/api/listener/profile-summary`, {
            credentials: 'include', cache: 'no-store', signal: controller.signal,
            headers: { Accept: 'application/json' },
        }).then(async response => {
            if (controller.signal.aborted) return;
            if (response.status === 401) { save('connect'); return; }
            if (!response.ok) throw new Error('Unavailable');
            const data = await response.json();
            if (controller.signal.aborted) return;
            // A sibling product may still hold a different person's session.
            if (data?.version !== 1 || data.identityKey !== identityKey) { save('connect'); return; }
            if ((data.listeningSeconds !== null && (!Number.isSafeInteger(data.listeningSeconds) || data.listeningSeconds < 0)) ||
                !MEMBERSHIPS.includes(data.membership?.kind) || !STATES.includes(data.membership?.state)) throw new Error('Invalid summary');
            save('ready', data);
        }).catch(() => { if (!controller.signal.aborted) save('unavailable'); }).finally(() => clearTimeout(timeout));
        return () => { clearTimeout(timeout); controller.abort(); };
    }, [identityKey, listenerOrigin, key, retry]);
    function refresh() { setSnapshot({ key, phase: 'loading' }); setRetry(value => value + 1); }
    const summary = current.summary;
    const plan = !summary ? '' : summary.membership.kind === 'founder' ? 'Plus · Founding Listener'
        : summary.membership.kind === 'invitation' ? (es ? 'Por invitación' : 'Invitation')
        : summary.membership.kind === 'preview' ? (es ? 'Acceso de prueba' : 'Preview')
        : summary.membership.kind === 'none' ? (es ? 'Gratis' : 'Free')
        : (es ? 'Estado de pago por confirmar' : 'Payment status unconfirmed');
    const states: Record<string, string> = es
        ? { active: 'Activa', grace: 'En período de gracia', ending: 'Activa hasta el fin del período', pending: 'Pendiente', expired: 'Finalizada', refunded: 'Reembolsada', revoked: 'Revocada', unknown: 'Consultá el estado en Listen', none: 'Sin suscripción paga' }
        : { active: 'Active', grace: 'Grace period', ending: 'Active until period end', pending: 'Pending', expired: 'Ended', refunded: 'Refunded', revoked: 'Revoked', unknown: 'Check status in Listen', none: 'No paid subscription' };
    return <section className="account-card account-listening" aria-labelledby="account-listening-title">
        <p className="account-eyebrow">Beacon Listen</p>
        <h2 id="account-listening-title">{es ? 'Tu tiempo de escucha' : 'Your listening time'}</h2>
        {current.phase === 'loading' && <p className="account-muted" role="status">{es ? 'Consultando tus horas y tu plan…' : 'Loading your hours and plan…'}</p>}
        {current.phase === 'ready' && summary && <>
            <p className="account-hours">{summary.listeningSeconds === null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(summary.listeningSeconds / 3600)} <span>{es ? 'horas' : 'hours'}</span></p>
            <p className="account-muted">{summary.listeningSeconds === null
                ? (es ? 'El registro de escucha no está disponible ahora.' : 'Listening records are currently unavailable.')
                : (es ? 'Escucha registrada en Listen. Las conexiones simultáneas cuentan una sola vez.' : 'Recorded time in Listen. Simultaneous connections count once.')}</p>
            <p className="account-membership"><strong>{plan}</strong><span>{states[summary.membership.state]}</span></p>
        </>}
        {current.phase === 'connect' && <p className="account-muted">{es ? 'Ingresá a Listen con esta misma cuenta para consultar tus horas y tu membresía.' : 'Sign in to Listen with this account to see your hours and membership.'}</p>}
        {current.phase === 'unavailable' && <p className="account-muted" role="status">{es ? 'No pudimos consultar tus horas y tu membresía ahora.' : 'Your hours and membership are currently unavailable.'}</p>}
        <div className="account-card-actions">
            <a className="account-secondary" href={`${listenerOrigin}/listener`}>{es ? 'Ir a escuchar' : 'Open Listen'} <span aria-hidden="true">↗</span></a>
            {current.phase !== 'loading' && <button className="account-link" type="button" onClick={refresh}>{es ? 'Actualizar' : 'Refresh'}</button>}
        </div>
    </section>;
}

export function AccountPsicopompoCard({ locale }: { locale: 'es' | 'en' }) {
    const es = locale === 'es';
    return <section className="account-card" aria-labelledby="account-pmp-title">
        <p className="account-eyebrow">PsicopoMPo</p>
        <h2 id="account-pmp-title">{es ? 'Tu espacio personal' : 'Your personal space'}</h2>
        <p className="account-muted">{es ? 'Continuá tu recorrido y consultá los materiales de tus experiencias en PsicopoMPo con tu cuenta Beacon.' : 'Continue your journey and access your experience materials in PsicopoMPo with your Beacon account.'}</p>
        <a className="account-secondary" href="https://psicopompo.altermundi.net/">{es ? 'Abrir PsicopoMPo' : 'Open PsicopoMPo'} <span aria-hidden="true">↗</span></a>
    </section>;
}

export function AccountResidence({ locale }: { locale: 'es' | 'en' }) {
    const es = locale === 'es';
    return <aside className="account-residence" aria-labelledby="account-residence-title">
        <div><p className="account-eyebrow">Harmonic Beacon Center</p>
            <h2 id="account-residence-title">{es ? 'Viví la experiencia en persona' : 'Experience Beacon in person'}</h2>
            <p>{es ? 'Conocé la residencia y la propuesta de encuentros presenciales de Harmonic Beacon.' : 'Discover the residence and Harmonic Beacon’s in-person experiences.'}</p>
        </div>
        <a className="account-secondary" href="https://eko.dmn.homes/view/1f31aa47ec864a2c83d954c4b62011d2?display=work">{es ? 'Conocer la residencia' : 'Explore the residence'} <span aria-hidden="true">↗</span></a>
    </aside>;
}
