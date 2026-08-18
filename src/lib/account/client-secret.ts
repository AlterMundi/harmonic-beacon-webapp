import { createHash } from 'node:crypto';

/** Byte-equivalent to oauth-provider 1.6.30's default SHA-256 hasher. */
export function hashAccountClientSecret(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('base64url');
}
