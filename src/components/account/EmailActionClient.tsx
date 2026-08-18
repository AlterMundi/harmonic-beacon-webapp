'use client';

import { useEffect, useRef, useState } from 'react';

export function EmailActionClient({ locale }: { locale: 'es' | 'en' }) {
    const started = useRef(false);
    const [status, setStatus] = useState<'working' | 'success' | 'error'>('working');
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const url = new URL(window.location.href);
        const token = url.searchParams.get('token');
        window.history.replaceState(null, '', '/verify-email');
        if (!token) {
            queueMicrotask(() => setStatus('error'));
            return;
        }
        fetch('/api/account/email-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ token }),
        }).then((response) => setStatus(response.ok ? 'success' : 'error'))
            .catch(() => setStatus('error'));
    }, []);
    const es = locale === 'es';
    return <div className="account-card">
        <h1>{status === 'working' ? (es ? 'Confirmando…' : 'Confirming…') : status === 'success' ? (es ? 'Confirmado' : 'Confirmed') : (es ? 'El enlace es inválido o venció' : 'This link is invalid or expired')}</h1>
        {status !== 'working' && <a className="account-primary account-inline" href={`/account?lang=${locale}`}>{es ? 'Continuar a Cuenta' : 'Continue to Account'}</a>}
    </div>;
}
