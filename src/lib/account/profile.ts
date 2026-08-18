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
