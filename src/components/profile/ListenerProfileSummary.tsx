'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';

type Summary = {
    listeningSeconds: number | null;
    membership: { kind: 'none' | 'invitation' | 'preview' | 'founder' | 'paid-status' | 'unknown'; state: string };
};
const STATES = ['none', 'pending', 'active', 'grace', 'ending', 'expired', 'refunded', 'revoked', 'unknown'];

export default function ListenerProfileSummary({ origin, identityKey }: {
    origin: 'https://listen.harmonicbeacon.com' | 'https://earlybirds-staging.harmonicbeacon.com';
    identityKey: string | null;
}) {
    const { locale } = useLocale();
    const es = locale === 'es';
    type Phase = 'loading' | 'ready' | 'connect' | 'unavailable';
    const [snapshot, setSnapshot] = useState<{ identityKey: string | null; origin: string; state: Phase; summary: Summary | null }>(
        { identityKey, origin, state: identityKey ? 'loading' : 'connect', summary: null });
    const current = snapshot.identityKey === identityKey && snapshot.origin === origin;
    const summary = current ? snapshot.summary : null;
    const state = current ? snapshot.state : identityKey ? 'loading' : 'connect';
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!identityKey) return;
        const save = (state: Phase, summary: Summary | null = null) => setSnapshot({ identityKey, origin, state, summary });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        void fetch(`${origin}/api/listener/profile-summary`, {
            credentials: 'include', cache: 'no-store', signal: controller.signal,
            headers: { Accept: 'application/json' },
        }).then(async response => {
            if (controller.signal.aborted) return;
            if (response.status === 401) { save('connect'); return; }
            if (!response.ok) throw new Error('Unavailable');
            const data = await response.json();
            if (controller.signal.aborted) return;
            if (data?.version !== 1 || data.identityKey !== identityKey) { save('connect'); return; }
            if ((data.listeningSeconds !== null && (!Number.isSafeInteger(data.listeningSeconds) || data.listeningSeconds < 0)) ||
                !['none', 'invitation', 'preview', 'founder', 'paid-status', 'unknown'].includes(data.membership?.kind) ||
                !STATES.includes(data.membership?.state)) throw new Error('Invalid summary');
            save('ready', data);
        }).catch(() => { if (!controller.signal.aborted) save('unavailable'); })
            .finally(() => clearTimeout(timeout));
        const onTimeout = () => save('unavailable');
        controller.signal.addEventListener('abort', onTimeout);
        return () => { controller.signal.removeEventListener('abort', onTimeout); clearTimeout(timeout); controller.abort(); };
    }, [origin, identityKey, retry]);
    function refresh() { setSnapshot({ identityKey, origin, state: 'loading', summary: null }); setRetry(value => value + 1); }
    const plan = !summary ? null : summary.membership.kind === 'founder' ? 'Plus · Founding Listener'
        : summary.membership.kind === 'invitation' ? (es ? 'Invitación' : 'Invitation')
        : summary.membership.kind === 'preview' ? (es ? 'Vista previa' : 'Preview')
        : summary.membership.kind === 'paid-status' ? (es ? 'Suscripción finalizada o pendiente' : 'Subscription ended or pending')
        : summary.membership.kind === 'unknown' ? (es ? 'Estado por confirmar' : 'Status unconfirmed') : (es ? 'Gratis' : 'Free');
    const labels: Record<string, string> = es
        ? { active: 'Activa', grace: 'Período de gracia', ending: 'Activa hasta el fin del período', pending: 'Pendiente', expired: 'Vencida', refunded: 'Reembolsada', revoked: 'Revocada', unknown: 'Consultá el estado en Beacon Listen', none: 'Sin suscripción paga' }
        : { active: 'Active', grace: 'Grace period', ending: 'Active until the end of the period', pending: 'Pending', expired: 'Expired', refunded: 'Refunded', revoked: 'Revoked', unknown: 'Check the status in Beacon Listen', none: 'No paid subscription' };
    return <section className="hb-profile-card" aria-labelledby="profile-membership-heading">
        <h2 id="profile-membership-heading">{es ? 'Mi escucha y membresía' : 'My listening and membership'}</h2>
        {state === 'loading' && <p role="status">{es ? 'Consultando tu plan…' : 'Loading your plan…'}</p>}
        {state === 'ready' && summary && <>
            <p className="hb-profile-plan">{plan}</p><p>{labels[summary.membership.state]}</p>
            <div className="hb-profile-hours">{summary.listeningSeconds === null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(summary.listeningSeconds / 3600)} h</div>
            <small>{summary.listeningSeconds === null ? (es ? 'Registro de escucha no disponible.' : 'Listening records unavailable.') : (es ? 'Horas de escucha de Beacon Listen. Las conexiones simultáneas cuentan una vez.' : 'Beacon Listen hours. Simultaneous connections count once.')}</small>
        </>}
        {state === 'connect' && <p>{es ? 'Abrí Beacon Listen con esta misma cuenta para ver tu plan y tus horas.' : 'Open Beacon Listen with this account to see your plan and hours.'}</p>}
        {state === 'unavailable' && <><p role="status">{es ? 'No pudimos consultar tu membresía ahora.' : 'Your membership is currently unavailable.'}</p>
            <button type="button" className="event-button event-button--secondary" onClick={refresh}>{es ? 'Reintentar' : 'Try again'}</button></>}
        <a href={`${origin}/listener/membership`} className="event-button event-button--secondary">{es ? 'Abrir Beacon Listen' : 'Open Beacon Listen'} ↗</a>
        <button type="button" className="event-button event-button--secondary" onClick={refresh} hidden={!identityKey || state === 'loading' || state === 'unavailable'}>{es ? 'Actualizar estado' : 'Refresh status'}</button>
    </section>;
}
