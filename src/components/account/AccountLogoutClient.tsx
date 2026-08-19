'use client';

import { useEffect, useRef, useState } from 'react';

import { completeFrontchannelLogout } from './AccountClient';

export default function AccountLogoutClient({
    mode,
    returnTo,
    locale,
    initiation,
}: {
    mode: 'current' | 'all';
    returnTo: string;
    locale: 'es' | 'en';
    initiation: string | null;
}) {
    const started = useRef(false);
    const [failed, setFailed] = useState(false);
    const es = locale === 'es';

    async function perform() {
        setFailed(false);
        try {
            const response = await fetch(`/api/account/logout/${mode}`, {
                method: 'POST', credentials: 'same-origin', cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(initiation ? { initiation } : {}),
            });
            const result = await response.json().catch(() => null) as { frontchannel?: string[] } | null;
            if (response.ok) await completeFrontchannelLogout(result?.frontchannel ?? []);
            if (response.ok || response.status === 401) window.location.replace(returnTo);
            else setFailed(true);
        } catch { setFailed(true); }
    }

    useEffect(() => {
        if (!initiation) return;
        if (started.current) return;
        started.current = true;
        void perform();
    // perform is intentionally bound to the immutable initiation payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initiation, mode, returnTo]);

    return (
        <section className="account-card account-card--logout" aria-live="polite">
            <h1>{es ? 'Cerrando sesión…' : 'Signing out…'}</h1>
            {!initiation && !failed && <button className="account-primary" onClick={perform}>
                {es ? 'Confirmar cierre de sesión' : 'Confirm sign out'}
            </button>}
            {failed && <>
                <p role="alert">{es ? 'No pudimos cerrar la sesión central.' : 'The central session could not be signed out.'}</p>
                <a className="account-primary" href={returnTo}>{es ? 'Volver' : 'Return'}</a>
            </>}
        </section>
    );
}
