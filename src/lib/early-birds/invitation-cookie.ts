const CANONICAL_INVITATION_TOKEN = /^ebi_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const EARLY_BIRD_INVITATION_COOKIE = '__Host-hb_early_bird_invitation';
export const EARLY_BIRD_INVITATION_MAX_AGE_SECONDS = 30 * 60;

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
