const EARLY_BIRD_ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

/** Byte-equivalent to the canonical authority's RFC 3986 unreserved account key. */
export function isEarlyBirdAccountId(value: unknown): value is string {
    return typeof value === 'string' && EARLY_BIRD_ACCOUNT_ID.test(value);
}
