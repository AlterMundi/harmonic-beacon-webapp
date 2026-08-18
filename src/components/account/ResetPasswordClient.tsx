'use client';

import { useEffect, useState, type FormEvent } from 'react';

import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    accountPasswordLengthValid,
} from '@/lib/account/password-policy';
import { AccountPasswordField } from './AccountPasswordField';

export function ResetPasswordClient({ locale }: { locale: 'es' | 'en' }) {
    const es = locale === 'es';
    const passwordHint = es
        ? `Usá entre ${ACCOUNT_PASSWORD_MIN_LENGTH} y ${ACCOUNT_PASSWORD_MAX_LENGTH} caracteres. No se exige ningún formato especial.`
        : `Use ${ACCOUNT_PASSWORD_MIN_LENGTH} to ${ACCOUNT_PASSWORD_MAX_LENGTH} characters. No special format is required.`;
    const passwordLengthError = es
        ? `La contraseña debe tener entre ${ACCOUNT_PASSWORD_MIN_LENGTH} y ${ACCOUNT_PASSWORD_MAX_LENGTH} caracteres.`
        : `Password must be ${ACCOUNT_PASSWORD_MIN_LENGTH} to ${ACCOUNT_PASSWORD_MAX_LENGTH} characters.`;
    const passwordMismatch = es ? 'Las contraseñas no coinciden.' : 'Passwords do not match.';
    const showPassword = es ? 'Mostrar contraseña' : 'Show password';
    const hidePassword = es ? 'Ocultar contraseña' : 'Hide password';
    const [token, setToken] = useState<string | null | undefined>(undefined);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const url = new URL(window.location.href);
        const incomingToken = url.searchParams.get('token');
        window.history.replaceState(null, '', '/reset-password');
        queueMicrotask(() => setToken(incomingToken));
    }, []);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        const password = String(form.get('password') ?? '');
        if (!accountPasswordLengthValid(password)) {
            setMessage(passwordLengthError);
            return;
        }
        if (password !== String(form.get('confirmPassword') ?? '')) {
            setMessage(passwordMismatch);
            return;
        }
        setBusy(true);
        try {
            const response = await fetch('/api/account/password/reset/complete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin', body: JSON.stringify({ token, password }),
            });
            setToken(null);
            setMessage(response.ok ? (es ? 'Contraseña cambiada. Ya podés ingresar.' : 'Password changed. You can sign in now.') : (es ? 'El enlace es inválido o venció.' : 'This link is invalid or expired.'));
        } catch {
            // A transport failure must not consume the client-held one-use
            // token or remove the form; the listener can retry safely.
            setMessage(es
                ? 'No se pudo completar la solicitud. Intentá nuevamente.'
                : 'The request could not be completed. Try again.');
        } finally {
            setBusy(false);
        }
    }
    return <div className="account-card">
        <h1>{es ? 'Restablecer contraseña' : 'Reset password'}</h1>
        {token === undefined ? <p className="account-message" role="status">
            {es ? 'Preparando…' : 'Preparing…'}
        </p> : token ? <form className="account-form" onSubmit={submit} aria-busy={busy}>
            <AccountPasswordField label={es ? 'Contraseña nueva' : 'New password'} showLabel={showPassword} hideLabel={hidePassword} name="password" minLength={ACCOUNT_PASSWORD_MIN_LENGTH} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} aria-describedby="account-reset-password-policy" required autoComplete="new-password" />
            <AccountPasswordField label={es ? 'Repetir contraseña nueva' : 'Repeat new password'} showLabel={showPassword} hideLabel={hidePassword} name="confirmPassword" minLength={ACCOUNT_PASSWORD_MIN_LENGTH} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} required autoComplete="new-password" />
            <p id="account-reset-password-policy" className="account-muted">{passwordHint}</p>
            {message && <p className="account-message" role="status" aria-live="polite">{message}</p>}
            <button className="account-primary" disabled={busy}>{es ? 'Cambiar contraseña' : 'Change password'}</button>
        </form> : <p className="account-message" role="status">{message || (es ? 'El enlace es inválido o venció.' : 'This link is invalid or expired.')}</p>}
        {!token && <a href={`/account?lang=${locale}`}>{es ? 'Volver a Cuenta' : 'Back to Account'}</a>}
    </div>;
}
