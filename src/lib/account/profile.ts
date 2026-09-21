export function normalizeBeaconDisplayName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    // Validate the raw provider/user input before trimming. JavaScript trim()
    // removes U+FEFF, which would otherwise let an invisible format character
    // pass application validation and then fail the matching PostgreSQL check.
    if (/[\p{Cc}\p{Cf}]/u.test(value)) return null;
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized.length < 1 || normalized.length > 60) {
        return null;
    }
    return normalized;
}

/** Self-declared private name. Never derive it from a provider or room alias. */
export function normalizeBeaconRealName(value: unknown): string | null {
    if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized.length >= 1 && normalized.length <= 120 ? normalized : null;
}

export function isBeaconProfileComplete(profile: {
    displayName?: unknown;
    realName?: unknown;
} | null | undefined): boolean {
    return Boolean(profile && normalizeBeaconDisplayName(profile.displayName) &&
        normalizeBeaconRealName(profile.realName));
}
