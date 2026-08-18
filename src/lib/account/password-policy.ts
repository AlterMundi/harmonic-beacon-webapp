/**
 * Canonical Account credential length policy.
 *
 * Passwords have no composition rules: every string inside this inclusive
 * range is eligible. Hashing, rate limits and reauthentication remain separate
 * security boundaries.
 */
export const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 128;

export function accountPasswordLengthValid(password: string): boolean {
    return password.length >= ACCOUNT_PASSWORD_MIN_LENGTH &&
        password.length <= ACCOUNT_PASSWORD_MAX_LENGTH;
}
