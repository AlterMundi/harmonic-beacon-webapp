'use client';

import { useEffect, useState, type FormEvent } from 'react';

export function ResetPasswordClient({ locale }: { locale: 'es' | 'en' }) {
    const es = locale === 'es';
    const [token, setToken] = useState<string | null | undefined>(undefined);
    const [message, setMessage] = useState('');
    useEffect(() => {
        const url = new URL(window.location.href);
        const incomingToken = url.searchParams.get('token');
        window.history.replaceState(null, '', '/reset-password');
        queueMicrotask(() => setToken(incomingToken));
    }, []);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const password = String(new FormData(event.currentTarget).get('password') ?? '');
        const response = await fetch('/api/account/password/reset/complete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin', body: JSON.stringify({ token, password }),
        });
        setToken(null);
        setMessage(response.ok ? (es ? 'Contraseña cambiada. Ya podés ingresar.' : 'Password changed. You can sign in now.') : (es ? 'El enlace es inválido o venció.' : 'This link is invalid or expired.'));
    }
    return <div className="account-card">
        <h1>{es ? 'Restablecer contraseña' : 'Reset password'}</h1>
        {token === undefined ? <p className="account-message" role="status">
            {es ? 'Preparando…' : 'Preparing…'}
        </p> : token ? <form className="account-form" onSubmit={submit}>
            <label>{es ? 'Contraseña nueva' : 'New password'}<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /></label>
            <button className="account-primary">{es ? 'Cambiar contraseña' : 'Change password'}</button>
        </form> : <p className="account-message" role="status">{message || (es ? 'El enlace es inválido o venció.' : 'This link is invalid or expired.')}</p>}
        {!token && <a href={`/account?lang=${locale}`}>{es ? 'Volver a Cuenta' : 'Back to Account'}</a>}
    </div>;
}
