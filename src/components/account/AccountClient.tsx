'use client';

import { useState, type FormEvent } from 'react';

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
}: {
    initialSession: AccountSession | null;
    providers: { google: boolean; apple: boolean };
    locale: 'es' | 'en';
    returnTo: string | null;
}) {
    const es = locale === 'es';
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

    async function submitCredentials(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const email = String(form.get('email') ?? '');
        const password = String(form.get('password') ?? '');
        setBusy(true); setMessage('');
        try {
            if (mode === 'forgot') {
                await post('/api/account/password/reset/request', locale, { email });
                setMessage(es ? 'Si la dirección es válida, el correo ya está en camino.' : 'If the address is eligible, an email is on its way.');
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
            const result = await response.json().catch(() => null) as { redirect?: string } | null;
            if (mode === 'signup') {
                setMessage(es ? 'Revisá tu correo para verificar la cuenta y después ingresá.' : 'Check your email to verify the account, then sign in.');
            } else if (response.ok) {
                window.location.replace(result?.redirect ?? callbackURL);
            } else {
                setMessage(es ? 'No se pudo ingresar. Revisá los datos e intentá nuevamente.' : 'Sign-in could not be completed. Check the details and try again.');
            }
        } finally { setBusy(false); }
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
        const response = await post('/api/account/password/change', locale, {
            currentPassword: String(form.get('currentPassword') ?? ''),
            newPassword: String(form.get('newPassword') ?? ''),
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

    if (!session) return (
        <div className="account-card">
            <div className="account-mode" role="group" aria-label={es ? 'Acción de cuenta' : 'Account action'}>
                <button type="button" aria-pressed={mode === 'signin'} onClick={() => setMode('signin')}>{es ? 'Ingresar' : 'Sign in'}</button>
                <button type="button" aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>{es ? 'Crear cuenta' : 'Create account'}</button>
            </div>
            <div className="account-providers">
                {providers.google && <button disabled={busy} onClick={() => social('google')}>{es ? 'Continuar con Google' : 'Continue with Google'}</button>}
                {providers.apple && <button disabled={busy} onClick={() => social('apple')}>{es ? 'Continuar con Apple' : 'Continue with Apple'}</button>}
            </div>
            <form onSubmit={submitCredentials} className="account-form">
                {mode === 'signup' && <label>{es ? 'Nombre visible' : 'Display name'}<input name="displayName" required minLength={1} maxLength={60} autoComplete="nickname" /></label>}
                <label>{es ? 'Correo' : 'Email'}<input name="email" type="email" required autoComplete="email" /></label>
                {mode !== 'forgot' && <label>{es ? 'Contraseña' : 'Password'}<input name="password" type="password" required minLength={12} maxLength={128} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>}
                <button className="account-primary" disabled={busy}>{mode === 'signin' ? (es ? 'Ingresar' : 'Sign in') : mode === 'signup' ? (es ? 'Crear cuenta' : 'Create account') : (es ? 'Enviar correo' : 'Send reset email')}</button>
            </form>
            <button className="account-link" type="button" onClick={() => setMode(mode === 'forgot' ? 'signin' : 'forgot')}>
                {mode === 'forgot' ? (es ? 'Volver al ingreso' : 'Back to sign in') : (es ? '¿Olvidaste tu contraseña?' : 'Forgot password?')}
            </button>
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
                    <label>{es ? 'Contraseña actual' : 'Current password'}<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
                    <label>{es ? 'Contraseña nueva' : 'New password'}<input name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
                    <button>{es ? 'Cambiar contraseña' : 'Change password'}</button>
                </form>
                <form onSubmit={changeEmail} className="account-form">
                    <label>{es ? 'Correo nuevo' : 'New email'}<input name="email" type="email" required autoComplete="email" /></label>
                    <label>{es ? 'Contraseña actual' : 'Current password'}<input name="password" type="password" required autoComplete="current-password" /></label>
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
