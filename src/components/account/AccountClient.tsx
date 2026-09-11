'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    accountPasswordLengthValid,
} from '@/lib/account/password-policy';
import { AccountPasswordField } from './AccountPasswordField';

type AccountSession = {
    user: { email: string | null; emailVerified: boolean; accessMethod: 'email' | 'google' | 'apple' };
    profile: { displayName: string; revision: number };
};

async function post(path: string, locale: 'es' | 'en', body?: unknown) {
    return fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-HB-Locale': locale },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
    });
}

export async function completeFrontchannelLogout(
    urls: string[],
    documentRoot: Document = document,
    timeoutMs = 5_000,
): Promise<void> {
    await Promise.all(urls.map((url) => new Promise<void>((resolve) => {
        const iframe = documentRoot.createElement('iframe');
        iframe.hidden = true;
        iframe.referrerPolicy = 'no-referrer';
        iframe.setAttribute('sandbox', '');
        const complete = () => {
            clearTimeout(timer);
            iframe.remove();
            resolve();
        };
        const timer = setTimeout(complete, timeoutMs);
        iframe.addEventListener('load', complete, { once: true });
        iframe.addEventListener('error', complete, { once: true });
        iframe.src = url;
        documentRoot.body.appendChild(iframe);
    })));
}

export default function AccountClient({
    initialSession,
    providers,
    locale,
    returnTo,
    requiredProvider,
}: {
    initialSession: AccountSession | null;
    providers: { google: boolean; apple: boolean };
    locale: 'es' | 'en';
    returnTo: string | null;
    requiredProvider?: 'google' | null;
}) {
    const es = locale === 'es';
    const passwordHint = es
        ? `Usá entre ${ACCOUNT_PASSWORD_MIN_LENGTH} y ${ACCOUNT_PASSWORD_MAX_LENGTH} caracteres. No se exige ningún formato especial.`
        : `Use ${ACCOUNT_PASSWORD_MIN_LENGTH} to ${ACCOUNT_PASSWORD_MAX_LENGTH} characters. No special format is required.`;
    const passwordLengthError = es
        ? `La contraseña debe tener entre ${ACCOUNT_PASSWORD_MIN_LENGTH} y ${ACCOUNT_PASSWORD_MAX_LENGTH} caracteres.`
        : `Password must be ${ACCOUNT_PASSWORD_MIN_LENGTH} to ${ACCOUNT_PASSWORD_MAX_LENGTH} characters.`;
    const credentialFailure = es
        ? 'No se pudo completar la solicitud. Revisá los datos e intentá nuevamente.'
        : 'The request could not be completed. Check the details and try again.';
    const passwordMismatch = es ? 'Las contraseñas no coinciden.' : 'Passwords do not match.';
    const showPassword = es ? 'Mostrar contraseña' : 'Show password';
    const hidePassword = es ? 'Ocultar contraseña' : 'Hide password';
    const callbackURL = `/account?lang=${locale}${returnTo ? `&return_to=${encodeURIComponent(returnTo)}` : ''}`;
    const oauthQuery = () => {
        const params = new URLSearchParams(window.location.search);
        return params.has('sig') && params.has('client_id') && params.has('exp')
            ? params.toString() : undefined;
    };
    const [session, setSession] = useState(initialSession);
    const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [signupAccepted, setSignupAccepted] = useState(false);
    const [feedbackFocusRevision, setFeedbackFocusRevision] = useState(0);
    const feedbackRef = useRef<HTMLParagraphElement>(null);
    const signupConfirmationRef = useRef<HTMLElement>(null);
    const signInEmailRef = useRef<HTMLInputElement>(null);
    const signInFocusRequested = useRef(false);
    const credentialSubmissionInFlight = useRef(false);

    useEffect(() => {
        if (feedbackFocusRevision === 0) return;
        const target = signupAccepted ? signupConfirmationRef.current : feedbackRef.current;
        target?.focus({ preventScroll: true });
        target?.scrollIntoView?.({ block: 'nearest' });
    }, [feedbackFocusRevision, signupAccepted]);

    useEffect(() => {
        if (!signInFocusRequested.current || mode !== 'signin' || signupAccepted) return;
        signInFocusRequested.current = false;
        signInEmailRef.current?.focus({ preventScroll: true });
        signInEmailRef.current?.scrollIntoView?.({ block: 'nearest' });
    }, [mode, signupAccepted]);

    function announceCredentialResult(nextMessage: string) {
        setMessage(nextMessage);
        setFeedbackFocusRevision((revision) => revision + 1);
    }

    function selectMode(nextMode: 'signin' | 'signup' | 'forgot') {
        setMode(nextMode);
        setMessage('');
        setSignupAccepted(false);
    }

    function returnToSignIn() {
        signInFocusRequested.current = true;
        selectMode('signin');
    }

    async function submitCredentials(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (credentialSubmissionInFlight.current) return;
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        const email = String(form.get('email') ?? '');
        const password = String(form.get('password') ?? '');
        if (mode !== 'forgot' && !accountPasswordLengthValid(password)) {
            setMessage(passwordLengthError);
            const input = event.currentTarget.elements.namedItem('password');
            if (input instanceof HTMLElement) input.focus();
            return;
        }
        if (mode === 'signup' && password !== String(form.get('confirmPassword') ?? '')) {
            setMessage(passwordMismatch);
            const input = event.currentTarget.elements.namedItem('confirmPassword');
            if (input instanceof HTMLElement) input.focus();
            return;
        }
        credentialSubmissionInFlight.current = true;
        setBusy(true);
        setMessage(mode === 'signup'
            ? (es ? 'Creando tu cuenta…' : 'Creating your account…')
            : '');
        try {
            if (mode === 'forgot') {
                const response = await post('/api/account/password/reset/request', locale, { email });
                announceCredentialResult(response.ok
                    ? (es ? 'Si la dirección es válida, el correo ya está en camino.' : 'If the address is eligible, an email is on its way.')
                    : credentialFailure);
                return;
            }
            const endpoint = mode === 'signup'
                ? '/api/account/auth/sign-up/email'
                : '/api/account/auth/sign-in/email';
            const response = await post(endpoint, locale, {
                email,
                password,
                ...(mode === 'signup' ? { name: String(form.get('displayName') ?? '') } : {}),
                callbackURL,
                oauth_query: oauthQuery(),
            });
            const result = await response.json().catch(() => null) as {
                redirect?: string;
                status?: string;
            } | null;
            if (mode === 'signup') {
                if (response.status === 202 && result?.status === 'accepted') {
                    formElement.reset();
                    setSignupAccepted(true);
                    announceCredentialResult(es
                        ? 'Si la solicitud es elegible, revisá tu correo para continuar.'
                        : 'If the request is eligible, check your email to continue.');
                } else {
                    announceCredentialResult(credentialFailure);
                }
            } else if (response.ok) {
                window.location.replace(result?.redirect ?? callbackURL);
            } else {
                announceCredentialResult(es ? 'No se pudo ingresar. Revisá los datos e intentá nuevamente.' : 'Sign-in could not be completed. Check the details and try again.');
            }
        } catch {
            announceCredentialResult(credentialFailure);
        } finally {
            credentialSubmissionInFlight.current = false;
            setBusy(false);
        }
    }

    async function social(provider: 'google' | 'apple') {
        setBusy(true); setMessage('');
        try {
            const response = await post(
                '/api/account/auth/sign-in/social',
                locale,
                { provider, callbackURL, oauth_query: oauthQuery() },
            );
            const result = await response.json().catch(() => null) as { url?: string } | null;
            if (response.ok && result?.url) window.location.assign(result.url);
            else setMessage(es ? 'El proveedor no está disponible en este momento.' : 'The provider is unavailable right now.');
        } finally { setBusy(false); }
    }

    async function saveProfile(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!session) return;
        const displayName = String(new FormData(event.currentTarget).get('displayName') ?? '');
        const response = await post('/api/account/profile', locale, {
            displayName, revision: session.profile.revision,
        });
        const result = await response.json().catch(() => null) as AccountSession['profile'] | null;
        if (response.ok && result) {
            setSession({ ...session, profile: result });
            setMessage(es ? 'Perfil actualizado.' : 'Profile updated.');
        } else setMessage(response.status === 409 ? (es ? 'El perfil cambió en otro lugar. Recargá y reintentá.' : 'Profile changed elsewhere. Reload and retry.') : (es ? 'No se pudo actualizar el perfil.' : 'Profile could not be updated.'));
    }

    async function changePassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const newPassword = String(form.get('newPassword') ?? '');
        if (!accountPasswordLengthValid(newPassword)) {
            setMessage(passwordLengthError);
            return;
        }
        if (newPassword !== String(form.get('confirmPassword') ?? '')) {
            setMessage(passwordMismatch);
            return;
        }
        const response = await post('/api/account/password/change', locale, {
            currentPassword: String(form.get('currentPassword') ?? ''),
            newPassword,
        });
        if (response.ok) window.location.replace('/account');
        else setMessage(es ? 'No se pudo cambiar la contraseña.' : 'Password could not be changed.');
    }

    async function changeEmail(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const response = await post('/api/account/email/change/request', locale, {
            email: String(form.get('email') ?? ''),
            password: String(form.get('password') ?? ''),
        });
        setMessage(response.ok
            ? (es ? 'Revisá la dirección nueva para confirmar el cambio.' : 'Check the new address to confirm the change.')
            : (es ? 'No se pudo iniciar el cambio de correo.' : 'Email change could not be started.'));
    }

    async function logout(path: '/api/account/logout/current' | '/api/account/logout/all') {
        setMessage('');
        const response = await post(path, locale);
        const result = await response.json().catch(() => null) as { frontchannel?: string[] } | null;
        if (response.ok) {
            await completeFrontchannelLogout(result?.frontchannel ?? []);
            window.location.replace(requiredProvider ? window.location.href : callbackURL);
            return;
        }
        if (response.status === 401) {
            window.location.replace(requiredProvider ? window.location.href : callbackURL);
            return;
        }
        setMessage(es
            ? 'No se pudo cerrar la sesión. Intentá nuevamente.'
            : 'Sign-out could not be completed. Try again.');
    }

    if (!session && signupAccepted) return (
        <div className="account-card">
            <section
                ref={signupConfirmationRef}
                className="account-signup-confirmation"
                role="status"
                aria-live="polite"
                tabIndex={-1}
            >
                <span className="account-signup-confirmation__mark" aria-hidden="true">&#10003;</span>
                <h2>{es ? 'Revisá tu correo' : 'Check your email'}</h2>
                <p>{message}</p>
            </section>
            <button className="account-primary" type="button" onClick={returnToSignIn}>
                {es ? 'Ir al ingreso' : 'Go to sign in'}
            </button>
        </div>
    );

    if (!session && requiredProvider === 'google') return (
        <div className="account-card">
            <p className="account-eyebrow">{es ? 'Acceso al evento' : 'Event access'}</p>
            <h2>{es ? 'Continuá con Google' : 'Continue with Google'}</h2>
            <p className="account-muted">
                {es
                    ? 'El evento es gratuito, pero necesitamos una cuenta Google para identificar tu presencia y tus créditos de ampliación.'
                    : 'The event is free, but a Google account is required to identify your attendance and amplification credits.'}
            </p>
            <div className="account-providers">
                {providers.google
                    ? <button disabled={busy} onClick={() => social('google')}>{es ? 'Continuar con Google' : 'Continue with Google'}</button>
                    : <p className="account-message" role="alert">{es ? 'Google no está disponible en este momento.' : 'Google is unavailable right now.'}</p>}
            </div>
        </div>
    );

    if (!session) return (
        <div className="account-card">
            <div className="account-mode" role="group" aria-label={es ? 'Acción de cuenta' : 'Account action'}>
                <button type="button" disabled={busy} aria-pressed={mode === 'signin'} onClick={() => selectMode('signin')}>{es ? 'Ingresar' : 'Sign in'}</button>
                <button type="button" disabled={busy} aria-pressed={mode === 'signup'} onClick={() => selectMode('signup')}>{es ? 'Crear cuenta' : 'Create account'}</button>
            </div>
            <div className="account-providers">
                {providers.google && <button disabled={busy} onClick={() => social('google')}>{es ? 'Continuar con Google' : 'Continue with Google'}</button>}
                {providers.apple && <button disabled={busy} onClick={() => social('apple')}>{es ? 'Continuar con Apple' : 'Continue with Apple'}</button>}
            </div>
            <form onSubmit={submitCredentials} className="account-form" aria-busy={busy} onInvalid={(event) => {
                const input = event.target;
                if (input instanceof HTMLInputElement &&
                    (input.name === 'password' || input.name === 'confirmPassword') &&
                    !accountPasswordLengthValid(input.value)) {
                    event.preventDefault();
                    setMessage(passwordLengthError);
                    input.focus();
                }
            }}>
                {mode === 'signup' && <label>{es ? 'Nombre visible' : 'Display name'}<input name="displayName" required minLength={1} maxLength={60} autoComplete="nickname" /></label>}
                <label>{es ? 'Correo' : 'Email'}<input
                    ref={mode === 'signin' ? signInEmailRef : undefined}
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                /></label>
                {mode !== 'forgot' && <AccountPasswordField
                    label={es ? 'Contraseña' : 'Password'}
                    showLabel={showPassword}
                    hideLabel={hidePassword}
                    name="password"
                    required
                    minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                    maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                    aria-describedby={mode === 'signup' ? 'account-password-policy' : undefined}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />}
                {mode === 'signup' && <AccountPasswordField
                    label={es ? 'Repetir contraseña' : 'Repeat password'}
                    showLabel={showPassword}
                    hideLabel={hidePassword}
                    name="confirmPassword"
                    required
                    minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                    maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                    autoComplete="new-password"
                />}
                {mode === 'signup' && <p id="account-password-policy" className="account-muted">{passwordHint}</p>}
                <p ref={feedbackRef} className="account-message" role="status" aria-live="polite" tabIndex={-1} hidden={!message}>{message}</p>
                <button className="account-primary" disabled={busy}>{mode === 'signin'
                    ? (es ? 'Ingresar' : 'Sign in')
                    : mode === 'signup'
                        ? busy ? (es ? 'Creando…' : 'Creating…') : (es ? 'Crear cuenta' : 'Create account')
                        : (es ? 'Enviar correo' : 'Send reset email')}</button>
            </form>
            <button className="account-link" type="button" onClick={() => selectMode(mode === 'forgot' ? 'signin' : 'forgot')}>
                {mode === 'forgot' ? (es ? 'Volver al ingreso' : 'Back to sign in') : (es ? '¿Olvidaste tu contraseña?' : 'Forgot password?')}
            </button>
        </div>
    );

    if (session && requiredProvider === 'google' && session.user.accessMethod !== 'google') return (
        <div className="account-card">
            <p className="account-eyebrow">{es ? 'Acceso al evento' : 'Event access'}</p>
            <h2>{es ? 'Se necesita una cuenta Google' : 'A Google account is required'}</h2>
            <p className="account-muted">
                {es
                    ? 'Cerrá esta sesión y volvé a ingresar con Continuar con Google.'
                    : 'Sign out of this session and sign in again with Continue with Google.'}
            </p>
            <button className="account-primary" onClick={() => logout('/api/account/logout/current')}>
                {es ? 'Cerrar sesión y continuar' : 'Sign out and continue'}
            </button>
            {message && <p className="account-message" role="status">{message}</p>}
        </div>
    );

    if (session && requiredProvider === 'google') return (
        <div className="account-card">
            <p className="account-eyebrow">{es ? 'Acceso al evento' : 'Event access'}</p>
            <h2>{es ? 'Confirmá tu cuenta Google' : 'Confirm your Google account'}</h2>
            <p className="account-muted">
                {es
                    ? 'Continuá con Google para volver al evento con esta identidad verificada.'
                    : 'Continue with Google to return to the event with this verified identity.'}
            </p>
            <button
                className="account-primary"
                disabled={busy || !providers.google}
                onClick={() => social('google')}
            >
                {es ? 'Continuar con Google' : 'Continue with Google'}
            </button>
            {!providers.google && <p className="account-message" role="alert">
                {es ? 'Google no está disponible en este momento.' : 'Google is unavailable right now.'}
            </p>}
            {message && <p className="account-message" role="status">{message}</p>}
        </div>
    );

    return (
        <div className="account-grid">
            <section className="account-card">
                <p className="account-eyebrow">{es ? 'Sesión iniciada' : 'Signed in'}</p>
                <h2>{session.profile.displayName}</h2>
                <p className="account-muted">{es ? 'Método de acceso' : 'Access method'}: {session.user.accessMethod === 'email' ? session.user.email : session.user.accessMethod}</p>
                <form onSubmit={saveProfile} className="account-form">
                    <label>{es ? 'Nombre visible' : 'Display name'}<input name="displayName" defaultValue={session.profile.displayName} required maxLength={60} /></label>
                    <button>{es ? 'Guardar perfil' : 'Save profile'}</button>
                </form>
            </section>
            {session.user.accessMethod === 'email' && <section className="account-card">
                <h2>{es ? 'Seguridad' : 'Security'}</h2>
                <form onSubmit={changePassword} className="account-form">
                    <AccountPasswordField label={es ? 'Contraseña actual' : 'Current password'} showLabel={showPassword} hideLabel={hidePassword} name="currentPassword" required autoComplete="current-password" />
                    <AccountPasswordField label={es ? 'Contraseña nueva' : 'New password'} showLabel={showPassword} hideLabel={hidePassword} name="newPassword" required minLength={ACCOUNT_PASSWORD_MIN_LENGTH} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} aria-describedby="account-new-password-policy" autoComplete="new-password" />
                    <AccountPasswordField label={es ? 'Repetir contraseña nueva' : 'Repeat new password'} showLabel={showPassword} hideLabel={hidePassword} name="confirmPassword" required minLength={ACCOUNT_PASSWORD_MIN_LENGTH} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} autoComplete="new-password" />
                    <p id="account-new-password-policy" className="account-muted">{passwordHint}</p>
                    <button>{es ? 'Cambiar contraseña' : 'Change password'}</button>
                </form>
                <form onSubmit={changeEmail} className="account-form">
                    <label>{es ? 'Correo nuevo' : 'New email'}<input name="email" type="email" required autoComplete="email" /></label>
                    <AccountPasswordField label={es ? 'Contraseña actual' : 'Current password'} showLabel={showPassword} hideLabel={hidePassword} name="password" required autoComplete="current-password" />
                    <button>{es ? 'Cambiar correo' : 'Change email'}</button>
                </form>
            </section>}
            <section className="account-card">
                <h2>{es ? 'Sesiones' : 'Sessions'}</h2>
                <div className="account-actions">
                    <button onClick={() => logout('/api/account/logout/current')}>{es ? 'Cerrar sesión aquí' : 'Sign out here'}</button>
                    <button onClick={() => logout('/api/account/logout/all')}>{es ? 'Cerrar sesión en todos lados' : 'Sign out everywhere'}</button>
                </div>
                {message && <p className="account-message" role="status">{message}</p>}
            </section>
            {returnTo && <a className="account-primary account-return" href={returnTo}>{es ? 'Volver al producto' : 'Return to product'}</a>}
        </div>
    );
}
