const ACCOUNT_ORIGIN = 'https://account.harmonicbeacon.com';
const ACCOUNT_STAGING_ORIGIN = 'https://account-staging.harmonicbeacon.com';

type Environment = Record<string, string | undefined>;

function value(name: string, environment: Environment): string | undefined {
    const resolved = environment[name]?.trim();
    return resolved || undefined;
}

function flag(name: string, environment: Environment): boolean {
    const resolved = value(name, environment);
    if (resolved === undefined || resolved === '0') return false;
    if (resolved === '1') return true;
    throw new Error(`${name} must be 0 or 1`);
}

function decodeBase64UrlJSON(value: string): unknown {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))));
}

export const ACCOUNT_AUTH_BASE_PATH = '/api/account/auth';
export const ACCOUNT_COOKIE_PREFIX = 'hb_account';
export const ACCOUNT_SESSION_COOKIE = '__Host-hb_account_session';
export const ACCOUNT_EMAIL_TTL_SECONDS = 15 * 60;

export function accountOrigin(environment: Environment = process.env): string {
    const configured = value('BEACON_ACCOUNT_BASE_URL', environment);
    if (configured) {
        const parsed = new URL(configured);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
            parsed.search || parsed.hash || parsed.pathname !== '/') {
            throw new Error('BEACON_ACCOUNT_BASE_URL must be an HTTPS origin');
        }
        return parsed.origin;
    }
    if (process.env.NODE_ENV === 'production') {
        throw new Error('BEACON_ACCOUNT_BASE_URL is required');
    }
    return 'http://localhost:3000';
}

export function accountEnvironment(environment: Environment = process.env): 'production' | 'staging' | 'local' {
    const origin = accountOrigin(environment);
    if (origin === ACCOUNT_ORIGIN) return 'production';
    if (origin === ACCOUNT_STAGING_ORIGIN) return 'staging';
    if (process.env.NODE_ENV !== 'production') return 'local';
    throw new Error('BEACON_ACCOUNT_BASE_URL is not an approved Account origin');
}

export function accountTokenPrefixes(environment: Environment = process.env) {
    const namespace = accountEnvironment(environment) === 'production' ? 'hb_acct_p' :
        accountEnvironment(environment) === 'staging' ? 'hb_acct_s' : 'hb_acct_l';
    return {
        opaqueAccessToken: `${namespace}_at_`,
        refreshToken: `${namespace}_rt_`,
    } as const;
}

export function accountSecret(environment: Environment = process.env): string {
    const secret = value('BEACON_ACCOUNT_AUTH_SECRET', environment);
    if (secret && secret.length >= 32) return secret;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('BEACON_ACCOUNT_AUTH_SECRET must contain at least 32 characters');
    }
    return 'account-local-only-secret-change-before-deploy';
}

export function accountRateSecret(environment: Environment = process.env): string | null {
    const secret = value('BEACON_ACCOUNT_RATE_SECRET', environment);
    return secret && secret.length >= 32 ? secret : null;
}

export function accountTrustedOrigins(environment: Environment = process.env): string[] {
    // Account is the sole browser credential authority. Product RPs use the
    // confidential OAuth backchannel and exact registered redirects; no
    // sibling origin needs authority cookies on a credential request.
    return [accountOrigin(environment)];
}

function providerBundle(
    provider: 'GOOGLE' | 'APPLE',
    environment: Environment,
): { clientId: string; clientSecret: string } | null {
    if (!flag(`BEACON_ACCOUNT_${provider}_ENABLED`, environment)) return null;
    const clientId = value(`BEACON_ACCOUNT_${provider}_CLIENT_ID`, environment);
    const clientSecret = value(`BEACON_ACCOUNT_${provider}_CLIENT_SECRET`, environment);
    if (!clientId || !clientSecret) {
        throw new Error(`Incomplete BEACON_ACCOUNT_${provider}_CLIENT_ID/CLIENT_SECRET`);
    }
    if (clientId.length > 512 || clientSecret.length < 16 || /\s/.test(clientId) || /\s/.test(clientSecret)) {
        throw new Error(`Invalid BEACON_ACCOUNT_${provider}_CLIENT_ID/CLIENT_SECRET`);
    }
    if (provider === 'GOOGLE' && !clientId.endsWith('.apps.googleusercontent.com')) {
        throw new Error('BEACON_ACCOUNT_GOOGLE_CLIENT_ID must be a Google OAuth client ID');
    }
    if (provider === 'APPLE' && !/^[A-Za-z0-9.-]{3,255}$/.test(clientId)) {
        throw new Error('BEACON_ACCOUNT_APPLE_CLIENT_ID must be an Apple Services ID');
    }
    if (provider === 'APPLE') {
        try {
            const [encodedHeader, encodedPayload, signature, extra] = clientSecret.split('.');
            if (!encodedHeader || !encodedPayload || !signature || extra) throw new Error('shape');
            const header = decodeBase64UrlJSON(encodedHeader) as {
                alg?: unknown; kid?: unknown;
            };
            const payload = decodeBase64UrlJSON(encodedPayload) as {
                iss?: unknown; sub?: unknown; aud?: unknown; iat?: unknown; exp?: unknown;
            };
            if (header.alg !== 'ES256' || typeof header.kid !== 'string' ||
                typeof payload.iss !== 'string' || payload.sub !== clientId ||
                payload.aud !== 'https://appleid.apple.com' ||
                typeof payload.iat !== 'number' || typeof payload.exp !== 'number' ||
                payload.exp <= Math.floor(Date.now() / 1_000)) throw new Error('claims');
        } catch {
            throw new Error('BEACON_ACCOUNT_APPLE_CLIENT_SECRET must be a valid current Apple client-secret JWT, never raw .p8 material');
        }
    }
    return { clientId, clientSecret };
}

export function accountSocialProviderConfiguration(environment: Environment = process.env) {
    return {
        google: providerBundle('GOOGLE', environment),
        apple: providerBundle('APPLE', environment),
    } as const;
}

export const ACCOUNT_STATIC_CLIENTS = [
    {
        clientId: 'hb-listener',
        secretVariable: 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER',
        redirectUri: 'https://listen.harmonicbeacon.com/api/account/callback',
        postLogoutRedirectUri: 'https://listen.harmonicbeacon.com/api/account/frontchannel-logout',
    },
    {
        clientId: 'hb-listener-staging',
        secretVariable: 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER_STAGING',
        redirectUri: 'https://earlybirds-staging.harmonicbeacon.com/api/account/callback',
        postLogoutRedirectUri: 'https://earlybirds-staging.harmonicbeacon.com/api/account/frontchannel-logout',
    },
    {
        clientId: 'hb-live',
        secretVariable: 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE',
        redirectUri: 'https://live.harmonicbeacon.com/api/account/callback',
        postLogoutRedirectUri: 'https://live.harmonicbeacon.com/api/account/frontchannel-logout',
    },
    {
        clientId: 'hb-live-staging',
        secretVariable: 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING',
        redirectUri: 'https://live-staging.harmonicbeacon.com/api/account/callback',
        postLogoutRedirectUri: 'https://live-staging.harmonicbeacon.com/api/account/frontchannel-logout',
    },
] as const;

export function accountStaticClientSecrets(environment: Environment = process.env) {
    return ACCOUNT_STATIC_CLIENTS.map((client) => ({
        ...client,
        clientSecret: value(client.secretVariable, environment) ?? null,
    }));
}

export function activeAccountStaticClients(environment: Environment = process.env) {
    const selected = accountEnvironment(environment);
    return ACCOUNT_STATIC_CLIENTS.filter((client) => selected === 'local' ||
        (selected === 'staging') === client.clientId.endsWith('-staging'));
}

export const ACCOUNT_NAV_RETURN_TO = new Set([
    'https://harmonicbeacon.com/',
    'https://listen.harmonicbeacon.com/',
    'https://earlybirds-staging.harmonicbeacon.com/',
    'https://live.harmonicbeacon.com/',
    'https://live-staging.harmonicbeacon.com/',
]);

export function isAccountHost(host: string | null): boolean {
    const normalized = host?.split(':', 1)[0]?.toLowerCase();
    return normalized === new URL(ACCOUNT_ORIGIN).hostname ||
        normalized === new URL(ACCOUNT_STAGING_ORIGIN).hostname ||
        (process.env.NODE_ENV !== 'production' && normalized === 'localhost');
}

export function isCurrentAccountHost(
    host: string | null,
    environment: Environment = process.env,
): boolean {
    const normalized = host?.split(':', 1)[0]?.toLowerCase();
    return normalized === new URL(accountOrigin(environment)).hostname;
}
