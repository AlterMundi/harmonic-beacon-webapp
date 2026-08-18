import {
    accountOrigin, accountStaticClientSecrets, activeAccountStaticClients, isAccountHost,
} from '@/lib/account/config';
import { accountRateSecret } from '@/lib/account/config';
import { consumeAccountRateLimit } from '@/lib/account/rate-limit';

function basicClientId(header: string | null): string | null {
    if (!header?.startsWith('Basic ')) return null;
    try {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        return decoded.split(':', 1)[0] || null;
    } catch { return null; }
}

function idTokenAudience(token: string | null): string | null {
    if (!token) return null;
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
            aud?: unknown;
        };
        return typeof payload.aud === 'string' ? payload.aud : null;
    } catch { return null; }
}

async function requestClientId(request: Request): Promise<string | null> {
    const url = new URL(request.url);
    const queryClient = url.searchParams.get('client_id');
    if (queryClient) return queryClient;
    const hintAudience = idTokenAudience(url.searchParams.get('id_token_hint'));
    if (hintAudience) return hintAudience;
    const basic = basicClientId(request.headers.get('authorization'));
    if (basic) return basic;
    if (request.method === 'POST' && request.headers.get('content-type')
        ?.includes('application/x-www-form-urlencoded')) {
        const body = await request.clone().formData();
        const client = body.get('client_id');
        if (typeof client === 'string' && client) return client;
        const hint = body.get('id_token_hint');
        return typeof hint === 'string' ? idTokenAudience(hint) : null;
    }
    return null;
}

export type AccountEndSessionRequest = {
    clientId: string;
    clientSecret: string;
    sid: string;
    state: string;
    postLogoutRedirectUri: string;
};

/** Structural admission only. The provider handler performs the authoritative
 * ID-token signature/issuer/audience verification before session deletion. */
export function accountEndSessionRequest(request: Request): AccountEndSessionRequest | null {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/api/account/auth/oauth2/end-session') return null;
    const allowed = new Set(['id_token_hint', 'client_id', 'post_logout_redirect_uri', 'state']);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) return null;
    const token = url.searchParams.get('id_token_hint');
    const clientId = url.searchParams.get('client_id');
    const postLogoutRedirectUri = url.searchParams.get('post_logout_redirect_uri');
    const state = url.searchParams.get('state');
    if (!token || token.length > 8192 || token.split('.').length !== 3 || !clientId ||
        !postLogoutRedirectUri || !state || !/^[A-Za-z0-9_-]{20,128}$/.test(state)) return null;
    const client = activeAccountStaticClients().find((candidate) => candidate.clientId === clientId);
    const clientSecret = accountStaticClientSecrets()
        .find((candidate) => candidate.clientId === clientId)?.clientSecret;
    if (!client || !clientSecret || postLogoutRedirectUri !== client.postLogoutRedirectUri) return null;
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
            iss?: unknown; aud?: unknown; sid?: unknown;
        };
        const audience = typeof payload.aud === 'string' ? [payload.aud]
            : Array.isArray(payload.aud) ? payload.aud : [];
        if (payload.iss !== accountOrigin() || !audience.includes(clientId) ||
            typeof payload.sid !== 'string' || payload.sid.length < 1 || payload.sid.length > 128) return null;
        return { clientId, clientSecret, sid: payload.sid, state, postLogoutRedirectUri };
    } catch { return null; }
}

export async function accountRequestAllowed(request: Request): Promise<boolean> {
    const url = new URL(request.url);
    if (!isAccountHost(request.headers.get('host') ?? url.host)) return false;
    const path = url.pathname;
    const exactMethod = new Map<string, ReadonlySet<string>>([
        ['/api/account/auth/sign-up/email', new Set(['POST'])],
        ['/api/account/auth/sign-in/email', new Set(['POST'])],
        ['/api/account/auth/sign-in/social', new Set(['POST'])],
        ['/api/account/auth/callback/google', new Set(['GET'])],
        // Apple uses form_post when name/email scopes are requested.
        ['/api/account/auth/callback/apple', new Set(['GET', 'POST'])],
        ['/api/account/auth/oauth2/authorize', new Set(['GET'])],
        ['/api/account/auth/oauth2/token', new Set(['POST'])],
        ['/api/account/auth/oauth2/introspect', new Set(['POST'])],
        ['/api/account/auth/oauth2/revoke', new Set(['POST'])],
        ['/api/account/auth/oauth2/userinfo', new Set(['GET'])],
        ['/api/account/auth/oauth2/end-session', new Set(['GET'])],
    ]);
    if (!exactMethod.get(path)?.has(request.method)) return false;
    if (path.endsWith('/userinfo')) return true;
    if (path.endsWith('/end-session')) return accountEndSessionRequest(request) !== null;
    if (request.method === 'POST' && [
        '/api/account/auth/oauth2/token',
        '/api/account/auth/oauth2/introspect',
        '/api/account/auth/oauth2/revoke',
    ].includes(path)) {
        if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
            'application/x-www-form-urlencoded') return false;
        const basic = basicClientId(request.headers.get('authorization'));
        if (!basic) return false;
        const body = await request.clone().formData().catch(() => null);
        if (!body || body.has('client_secret')) return false;
        const bodyClient = body.get('client_id');
        if (typeof bodyClient === 'string' && bodyClient !== basic) return false;
        return activeAccountStaticClients().some((client) => client.clientId === basic);
    }
    if (!path.includes('/oauth2/')) return true;
    const clientId = await requestClientId(request);
    if (!clientId) return false;
    return activeAccountStaticClients().some((client) => client.clientId === clientId);
}

const SENSITIVE_AUTH_PATHS = new Map([
    ['/api/account/auth/sign-up/email', 'signup'],
    ['/api/account/auth/sign-in/email', 'signin'],
    ['/api/account/auth/sign-in/social', 'social'],
]);

/** Durable admission before Better Auth sees any public credential attempt. */
export async function accountCredentialRequestAllowed(request: Request): Promise<boolean> {
    const purpose = SENSITIVE_AUTH_PATHS.get(new URL(request.url).pathname);
    if (!purpose || request.method !== 'POST') return true;
    const secret = accountRateSecret();
    if (!secret) return false;
    const body = await request.clone().json().catch(() => null) as {
        email?: unknown; provider?: unknown;
    } | null;
    const email = typeof body?.email === 'string' ? body.email : `${purpose}:no-email`;
    const socialProvider = purpose === 'social' &&
        (body?.provider === 'google' || body?.provider === 'apple')
        ? body.provider : 'unknown';
    return consumeAccountRateLimit({
        request,
        email,
        purpose: purpose === 'social' ? `social-${socialProvider}` : purpose,
        secret,
        maxPerEmail: purpose === 'signin' ? 8 : 4,
        maxPerOrigin: purpose === 'social' ? 30 : 15,
        maxGlobal: 1_000,
        includeEmailBucket: purpose !== 'social',
    });
}
