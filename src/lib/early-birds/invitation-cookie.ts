const CANONICAL_INVITATION_TOKEN = /^ebi_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const LISTENER_INVITATION_HOSTS = new Set([
    'listen.harmonicbeacon.com',
    'earlybirds-staging.harmonicbeacon.com',
]);
const LISTENER_INVITATION_COOKIE_HOST = 'listen.harmonicbeacon.com';
const LISTENER_INVITATION_STAGING_HOST = 'earlybirds-staging.harmonicbeacon.com';

export const LISTENER_INVITATION_CANONICAL_ORIGIN = 'https://listen.harmonicbeacon.com';

export const EARLY_BIRD_INVITATION_COOKIE = '__Host-hb_early_bird_invitation';
export const EARLY_BIRD_INVITATION_MAX_AGE_SECONDS = 30 * 60;

/** Public product and isolated preview are the only invitation entry hosts. */
export function earlyBirdInvitationHost(hostname: string): boolean {
    return LISTENER_INVITATION_HOSTS.has(hostname.toLowerCase());
}

export function earlyBirdInvitationCookieHost(hostname: string): boolean {
    return hostname.toLowerCase() === LISTENER_INVITATION_COOKIE_HOST;
}

export function earlyBirdInvitationStagingHost(hostname: string): boolean {
    return hostname.toLowerCase() === LISTENER_INVITATION_STAGING_HOST;
}

export function canonicalEarlyBirdInvitation(value: unknown): string | null {
    if (typeof value !== 'string' || value.length < 32 || value.length > 512) return null;
    return CANONICAL_INVITATION_TOKEN.test(value) ? value : null;
}

export function earlyBirdInvitationCookie(value: string) {
    return {
        name: EARLY_BIRD_INVITATION_COOKIE,
        value,
        httpOnly: true,
        secure: true,
        sameSite: 'lax' as const,
        path: '/',
        maxAge: EARLY_BIRD_INVITATION_MAX_AGE_SECONDS,
    };
}

export function clearedEarlyBirdInvitationCookie() {
    return {
        ...earlyBirdInvitationCookie(''),
        maxAge: 0,
        expires: new Date(0),
    };
}
