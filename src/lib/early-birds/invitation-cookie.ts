const CANONICAL_INVITATION_TOKEN = /^ebi_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const LISTENER_INVITATION_HOSTS = new Set([
    'listen.harmonicbeacon.com',
    'earlybirds-staging.harmonicbeacon.com',
]);
const LISTENER_INVITATION_COOKIE_HOST = 'listen.harmonicbeacon.com';
const LISTENER_INVITATION_STAGING_HOST = 'earlybirds-staging.harmonicbeacon.com';

export const LISTENER_INVITATION_CANONICAL_ORIGIN = 'https://listen.harmonicbeacon.com';

export const LISTENER_INVITATION_COOKIE = '__Host-hb_listener_invitation';
export const EARLY_BIRD_INVITATION_COOKIE = '__Host-hb_early_bird_invitation';
export const EARLY_BIRD_INVITATION_MAX_AGE_SECONDS = 30 * 60;

const LISTENER_INVITATION_COOKIE_NAMES = [
    LISTENER_INVITATION_COOKIE,
    EARLY_BIRD_INVITATION_COOKIE,
] as const;

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

function invitationCookie(name: string, value: string) {
    return {
        name,
        value,
        httpOnly: true,
        secure: true,
        sameSite: 'lax' as const,
        path: '/',
        maxAge: EARLY_BIRD_INVITATION_MAX_AGE_SECONDS,
    };
}

/** Legacy single-cookie constructor retained for rollback-compatible callers. */
export function earlyBirdInvitationCookie(value: string) {
    return invitationCookie(EARLY_BIRD_INVITATION_COOKIE, value);
}

function cookieHeaderValues(header: string | null, name: string): string[] {
    if (!header) return [];
    return header.split(';').flatMap((part) => {
        const separator = part.indexOf('=');
        if (separator < 1 || part.slice(0, separator).trim() !== name) return [];
        return [part.slice(separator + 1).trim()];
    });
}

/** Canonical-first raw-header read that rejects duplicate or conflicting cookies. */
export function listenerInvitationFromCookieHeader(header: string | null): string | null {
    const values = LISTENER_INVITATION_COOKIE_NAMES.map((name) => (
        cookieHeaderValues(header, name)
    ));
    const [canonicalValues, legacyValues] = values;
    if (canonicalValues.length > 1 || legacyValues.length > 1) return null;

    const canonicalValue = canonicalValues[0];
    const legacyValue = legacyValues[0];
    if (canonicalValue !== undefined) {
        const canonical = canonicalEarlyBirdInvitation(canonicalValue);
        if (!canonical) return null;
        if (legacyValue !== undefined && legacyValue !== canonical) return null;
        return canonical;
    }
    return canonicalEarlyBirdInvitation(legacyValue);
}

/** Dual-write keeps in-flight legacy pages and rollback images compatible. */
export function listenerInvitationCookies(value: string) {
    return LISTENER_INVITATION_COOKIE_NAMES.map((name) => invitationCookie(name, value));
}

export function clearedEarlyBirdInvitationCookie() {
    return {
        ...earlyBirdInvitationCookie(''),
        maxAge: 0,
        expires: new Date(0),
    };
}

export function clearedListenerInvitationCookies() {
    return LISTENER_INVITATION_COOKIE_NAMES.map((name) => ({
        ...invitationCookie(name, ''),
        maxAge: 0,
        expires: new Date(0),
    }));
}
