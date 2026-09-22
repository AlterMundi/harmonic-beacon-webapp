/** Server-only projection of Account UserInfo; never spread this into room payloads. */
export type AccountProfileClaims = {
    preferredName: string | null;
    email: string | null;
    emailVerified: boolean | null;
    profileComplete: boolean;
};

function preferredName(value: unknown): string | null {
    if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized.length > 0 && normalized.length <= 60 ? normalized : null;
}

export function accountProfileClaims(payload: Record<string, unknown>): AccountProfileClaims {
    // Account may deliberately omit email (e.g. an unavailable provider address).
    // Missing verification is unknown, never silently promoted to true or false.
    const email = typeof payload.email === 'string' && payload.email.length <= 320 &&
        /^[^\s@\p{Cc}\p{Cf}]+@[^\s@\p{Cc}\p{Cf}]+\.[^\s@\p{Cc}\p{Cf}]+$/u.test(payload.email) &&
        !payload.email.toLowerCase().endsWith('@identity.invalid')
        ? payload.email : null;
    const name = preferredName(payload.preferred_name ?? payload.name ?? payload.preferred_username);
    return {
        preferredName: name,
        email,
        emailVerified: email && typeof payload.email_verified === 'boolean' ? payload.email_verified : null,
        profileComplete: Boolean(name && payload.profile_complete === true),
    };
}
