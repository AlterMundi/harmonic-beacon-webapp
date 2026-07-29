/**
 * Client address as seen through the launch reverse proxy.
 *
 * `X-Forwarded-For` is a list every hop appends to, so any prefix the client
 * itself supplied is forgeable. Only the entries our own proxies wrote can be
 * trusted, and those sit at the right-hand end: Nginx appends the peer it saw,
 * and Cloudflare (when it is in front) has already written the browser address.
 * So with N trusted hops the real client is N entries from the right.
 *
 * Used to key the auth rate limiter. A forgeable key is worse than no key —
 * it lets one attacker mint a fresh bucket per request — so every ambiguous
 * case resolves to a single shared bucket rather than to attacker-supplied
 * text. That over-limits (all unattributable requests share one budget) and
 * never under-limits.
 */

import { redactError } from '@/lib/redact';

export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * Bucket for requests whose client address cannot be attributed: no proxy
 * headers at all (local development), or a chain shorter than the configured
 * number of trusted hops (a request that did not traverse them).
 */
export const UNATTRIBUTED_CLIENT_ADDRESS = 'unattributed';

export function trustedProxyHops(rawValue = process.env.TRUSTED_PROXY_HOPS): number {
    if (rawValue === undefined || rawValue === '') {
        return DEFAULT_TRUSTED_PROXY_HOPS;
    }

    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error('TRUSTED_PROXY_HOPS must be a positive integer');
    }
    return value;
}

function normalizeAddress(value: string): string {
    // IPv6 literals arrive bracketed from some proxies and bare from others;
    // both spellings must key the same bucket.
    return value.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

/**
 * `null` when the deployment is misconfigured.
 *
 * `trustedProxyHops` throws so that ops tooling and tests see a bad value, but a
 * request path must not: taking the login endpoints down over an env var would
 * turn a typo into a locked-out event. Degrading to one shared bucket keeps the
 * limiter working, strictly, without trusting the header.
 */
function configuredHops(): number | null {
    try {
        return trustedProxyHops();
    } catch (error) {
        console.warn(
            `[auth] ${redactError(error)}; keying the login limiter on one shared bucket until it is fixed`,
        );
        return null;
    }
}

export function clientAddress(headers: Headers, hops: number | null = configuredHops()): string {
    if (hops === null) {
        return UNATTRIBUTED_CLIENT_ADDRESS;
    }

    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
        const chain = forwarded
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);

        // Deliberately not clamped to the leftmost entry when the chain is too
        // short: that entry is whatever the caller sent, and honouring it would
        // hand the limiter's key to the attacker.
        const client = chain[chain.length - hops];
        if (client) {
            return normalizeAddress(client);
        }
        return UNATTRIBUTED_CLIENT_ADDRESS;
    }

    const realIp = headers.get('x-real-ip');
    if (realIp && realIp.trim().length > 0) {
        return normalizeAddress(realIp);
    }

    return UNATTRIBUTED_CLIENT_ADDRESS;
}
