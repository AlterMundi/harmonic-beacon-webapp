'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    accountPasswordLengthValid,
} from '@/lib/account/password-policy';
import { AccountPasswordField } from './AccountPasswordField';
import { AccountListeningCard, AccountPsicopompoCard, AccountResidence, type AccountHome } from './AccountActivity';

type AccountSession = {
    user: { email: string | null; emailVerified: boolean; accessMethod: 'email' | 'google' | 'apple' };
    profile: { displayName: string; realName?: string | null; revision: number };
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
    home = null,
}: {
    initialSession: AccountSession | null;
    providers: { google: boolean; apple: boolean };
    locale: 'es' | 'en';
    returnTo: string | null;
    home?: AccountHome | null;
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
    const [editingProfile, setEditingProfile] = useState(Boolean(initialSession && !initialSession.profile.realName));
    const [profileBusy, setProfileBusy] = useState(false);
    const editButtonRef = useRef<HTMLButtonElement>(null);
    const preferredNameRef = useRef<HTMLInputElement>(null);
    const [signupAccepted, setSignupAccepted] = useState(false);
    const [feedbackFocusRevision, setFeedbackFocusRevision] = useState(0);
    const feedbackRef = useRef<HTMLParagraphElement>(null);
    const signupConfirmationRef = useRef<HTMLElement>(null);
    const signInEmailRef = useRef<HTMLInputElement>(null);
    const authHeadingRef = useRef<HTMLHeadingElement>(null);
    const signInFocusRequested = useRef(false);
    const credentialSubmissionInFlight = useRef(false);

    useEffect(() => {
        if (mode === 'signin') return;
        authHeadingRef.current?.focus({ preventScroll: true });
        authHeadingRef.current?.scrollIntoView?.({ block: 'nearest' });
    }, [mode]);

    useEffect(() => {
        if (editingProfile) preferredNameRef.current?.focus({ preventScroll: true });
    }, [editingProfile]);

    function closeProfileEditor() {
        setEditingProfile(false);
        requestAnimationFrame(() => editButtonRef.current?.focus({ preventScroll: true }));
    }

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
                ...(mode === 'signup' ? {
                    name: String(form.get('displayName') ?? ''),
                    realName: String(form.get('realName') ?? ''),
                } : {}),
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
        if (!session || profileBusy) return;
        const displayName = String(new FormData(event.currentTarget).get('displayName') ?? '');
        const realName = String(new FormData(event.currentTarget).get('realName') ?? '');
        setProfileBusy(true);
        setMessage('');
        try {
            const response = await post('/api/account/profile', locale, {
                displayName, realName, revision: session.profile.revision,
            });
            const result = await response.json().catch(() => null) as AccountSession['profile'] | null;
            if (response.ok && result) {
                setSession({ ...session, profile: result });
                const pendingOAuth = oauthQuery();
                if (pendingOAuth) {
                    const continued = await post('/api/account/auth/oauth2/continue', locale, {
                        postLogin: true, oauth_query: pendingOAuth,
                    });
                    const continuation = await continued.json().catch(() => null) as {
                        redirect?: string; status?: string;
                    } | null;
                    if (continued.ok && continuation?.status === 'continued' && continuation.redirect) {
                        window.location.replace(continuation.redirect);
                        return;
                    }
                    setMessage(es
                        ? 'Perfil actualizado. Volvé a intentar continuar.'
                        : 'Profile updated. Try continuing again.');
                    return;
                }
                setMessage(es ? 'Perfil actualizado.' : 'Profile updated.');
                closeProfileEditor();
            } else setMessage(response.status === 409 ? (es ? 'El perfil cambió en otro lugar. Recargá y reintentá.' : 'Profile changed elsewhere. Reload and retry.') : (es ? 'No se pudo actualizar el perfil.' : 'Profile could not be updated.'));
        } catch {
            setMessage(es ? 'No se pudo guardar. Tus cambios siguen en el formulario; intentá nuevamente.' : 'Could not save. Your changes are still in the form; try again.');
        } finally { setProfileBusy(false); }
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
            window.location.replace(callbackURL);
            return;
        }
        if (response.status === 401) {
            window.location.replace(callbackURL);
            return;
        }
        setMessage(es
            ? 'No se pudo cerrar la sesión. Intentá nuevamente.'
            : 'Sign-out could not be completed. Try again.');
    }

    if (!session && signupAccepted) return (
        <div className="account-welcome"><header className="account-welcome-copy">
            <h1>{es ? 'Bienvenido a Harmonic Beacon' : 'Welcome to Harmonic Beacon'}</h1>
            <p>{es ? 'Una cuenta para Beacon y PsicopoMPo.' : 'One account for Beacon and PsicopoMPo.'}</p>
        </header><div className="account-card">
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
                {es ? 'Iniciar sesión' : 'Go to sign in'}
            </button>
        </div></div>
    );

    if (!session) return (
        <div className="account-welcome">
            <header className="account-welcome-copy">
                <h1>{es ? 'Bienvenido a Harmonic Beacon' : 'Welcome to Harmonic Beacon'}</h1>
                <p>{es ? 'Una cuenta para escuchar Beacon, participar en encuentros y acceder a PsicopoMPo.' : 'One account to listen to Beacon, join events and access PsicopoMPo.'}</p>
            </header>
        <div className="account-access-options">
        <div className="account-card account-access-card">
            <h2 id="account-auth-heading" ref={authHeadingRef} tabIndex={-1}>{mode === 'signup'
                ? (es ? 'Crear cuenta' : 'Create account')
                : mode === 'forgot' ? (es ? 'Recuperar contraseña' : 'Reset password')
                    : (es ? 'Iniciar sesión' : 'Sign in')}</h2>
            {mode !== 'forgot' && <div className="account-providers">
                {providers.google && <button disabled={busy} onClick={() => social('google')}>{es ? 'Continuar con Google' : 'Continue with Google'}</button>}
                {providers.apple && <button disabled={busy} onClick={() => social('apple')}>{es ? 'Continuar con Apple' : 'Continue with Apple'}</button>}
            </div>}
            {mode !== 'forgot' && (providers.google || providers.apple) && <p className="account-divider"><span>{es ? 'o con tu correo' : 'or with your email'}</span></p>}
            <form key={mode} onSubmit={submitCredentials} className="account-form" aria-labelledby="account-auth-heading" aria-busy={busy} onInvalid={(event) => {
                const input = event.target;
                if (input instanceof HTMLInputElement &&
                    (input.name === 'password' || input.name === 'confirmPassword') &&
                    !accountPasswordLengthValid(input.value)) {
                    event.preventDefault();
                    setMessage(passwordLengthError);
                    input.focus();
                }
            }}>
                {mode === 'signup' && <>
                    <label>{es ? 'Nombre real (privado)' : 'Real name (private)'}<input name="realName" required minLength={1} maxLength={120} autoComplete="name" /></label>
                    <label>{es ? 'Nombre preferido' : 'Preferred name'}<input name="displayName" required minLength={1} maxLength={60} autoComplete="nickname" /></label>
                </>}
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
                    ? (es ? 'Iniciar sesión' : 'Sign in')
                    : mode === 'signup'
                        ? busy ? (es ? 'Creando…' : 'Creating…') : (es ? 'Crear cuenta' : 'Create account')
                        : (es ? 'Enviar correo' : 'Send reset email')}</button>
            </form>
            {mode === 'signin' && <button className="account-link" type="button" disabled={busy} onClick={() => selectMode('forgot')}>
                {es ? '¿Olvidaste tu contraseña?' : 'Forgot password?'}
            </button>}
        </div>
            <div className="account-registration-prompt">
                {mode === 'signin' ? <>
                    <span>{es ? '¿No tenés cuenta?' : 'Don’t have an account?'}</span>
                    <button type="button" disabled={busy} onClick={() => selectMode('signup')}>{es ? 'Registrate' : 'Register'}</button>
                </> : <>
                    {mode === 'signup' && <span>{es ? '¿Ya tenés cuenta?' : 'Already have an account?'}</span>}
                    <button type="button" disabled={busy} onClick={returnToSignIn}>{mode === 'forgot'
                        ? (es ? 'Volver a iniciar sesión' : 'Back to sign in')
                        : (es ? 'Iniciá sesión' : 'Sign in')}</button>
                </>}
            </div>
        </div></div>
    );

    return (
        <div className="account-home">
            <header className="account-profile-header">
                <p className="account-eyebrow">{es ? 'Mi cuenta' : 'My account'}</p>
                <div className="account-name-row"><h1>{session.profile.displayName}</h1>
                    <button ref={editButtonRef} type="button" className="account-edit-name" disabled={profileBusy} aria-label={es ? 'Editar mi nombre' : 'Edit my name'} aria-expanded={editingProfile} aria-controls="account-profile-editor" onClick={() => { setMessage(''); setEditingProfile(value => !value); }}>
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m14.5 5.5 4 4M4 20l4.5-1 12-12a2.8 2.8 0 0 0-4-4l-12 12L4 20Z" /></svg>
                    </button>
                </div>
                <p className="account-muted">{es ? 'Tu actividad y tus experiencias en Harmonic Beacon.' : 'Your activity and experiences in Harmonic Beacon.'}</p>
                {returnTo && <a className="account-secondary account-return" href={returnTo}>{es ? 'Volver al producto' : 'Return to product'} <span aria-hidden="true">↗</span></a>}
            </header>
            {editingProfile && <section className="account-card account-profile-editor" id="account-profile-editor" aria-label={es ? 'Editar perfil' : 'Edit profile'}>
                <h2>{es ? 'Cómo querés que te llamemos' : 'What would you like to be called?'}</h2>
                <form onSubmit={saveProfile} className="account-form" aria-busy={profileBusy}>
                    <label>{es ? 'Nombre preferido' : 'Preferred name'}<input ref={preferredNameRef} name="displayName" defaultValue={session.profile.displayName} disabled={profileBusy} required minLength={1} maxLength={60} autoComplete="nickname" /></label>
                    <label>{es ? 'Nombre real (privado)' : 'Real name (private)'}<input name="realName" defaultValue={session.profile.realName ?? ''} disabled={profileBusy} required minLength={1} maxLength={120} autoComplete="name" /></label>
                    <p className="account-muted">{es ? 'Tu nombre preferido es el que se muestra. Tu nombre real permanece privado.' : 'Your preferred name is displayed. Your real name stays private.'}</p>
                    <div className="account-card-actions"><button className="account-primary" disabled={profileBusy}>{profileBusy ? (es ? 'Guardando…' : 'Saving…') : (es ? 'Guardar cambios' : 'Save changes')}</button>
                        <button type="button" disabled={profileBusy} onClick={closeProfileEditor}>{es ? 'Cancelar' : 'Cancel'}</button></div>
                </form>
            </section>}
            {message && <p className="account-message account-feedback" role="status">{message}</p>}
            {home && <div className="account-grid"><AccountListeningCard home={home} locale={locale} /><AccountPsicopompoCard locale={locale} /></div>}
            <AccountResidence locale={locale} />
            <details className="account-security">
                <summary>{es ? 'Acceso y seguridad' : 'Sign-in and security'}</summary>
                <div className="account-grid">
            {session.user.accessMethod === 'email' && <section className="account-card">
                <h2>{es ? 'Contraseña y correo' : 'Password and email'}</h2>
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
                <p className="account-muted">{es ? 'Ingresaste con' : 'Signed in with'} {session.user.accessMethod === 'email' ? session.user.email : session.user.accessMethod === 'google' ? 'Google' : 'Apple'}.</p>
                <div className="account-actions">
                    <button onClick={() => logout('/api/account/logout/current')}>{es ? 'Cerrar sesión aquí' : 'Sign out here'}</button>
                    <button onClick={() => logout('/api/account/logout/all')}>{es ? 'Cerrar sesión en todos lados' : 'Sign out everywhere'}</button>
                </div>
            </section>
                </div>
            </details>
        </div>
    );
}
