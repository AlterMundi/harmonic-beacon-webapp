import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_TRUSTED_PROXY_HOPS,
    UNATTRIBUTED_CLIENT_ADDRESS,
    clientAddress,
    trustedProxyHops,
} from '../client-address';

function headers(values: Record<string, string>): Headers {
    return new Headers(values);
}

describe('clientAddress', () => {
    it('takes the entry the single trusted proxy wrote', () => {
        expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.9' }), 1)).toBe('203.0.113.9');
    });

    it('ignores a forged prefix the client supplied', () => {
        // The attacker sent "X-Forwarded-For: 1.1.1.1"; Nginx appended the peer it
        // actually saw. Only the appended entry may key the limiter.
        const address = clientAddress(
            headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }),
            1,
        );
        expect(address).toBe('203.0.113.9');
    });

    it('counts back one entry per trusted hop', () => {
        // Cloudflare wrote the browser address, Nginx appended Cloudflare's.
        const address = clientAddress(
            headers({ 'x-forwarded-for': '198.51.100.7, 172.70.1.1' }),
            2,
        );
        expect(address).toBe('198.51.100.7');
    });

    it('refuses to key on a chain shorter than the trusted hop count', () => {
        // A request that skipped a configured proxy: its only entry is
        // attacker-controlled, so it must not become a per-request bucket.
        expect(clientAddress(headers({ 'x-forwarded-for': '1.1.1.1' }), 2)).toBe(
            UNATTRIBUTED_CLIENT_ADDRESS,
        );
    });

    it('normalizes whitespace and IPv6 bracket spelling to one bucket', () => {
        const bracketed = clientAddress(headers({ 'x-forwarded-for': ' [2001:DB8::1] ' }), 1);
        const bare = clientAddress(headers({ 'x-forwarded-for': '2001:db8::1' }), 1);
        expect(bracketed).toBe('2001:db8::1');
        expect(bare).toBe(bracketed);
    });

    it('falls back to x-real-ip, then to the shared bucket', () => {
        expect(clientAddress(headers({ 'x-real-ip': '203.0.113.4' }), 1)).toBe('203.0.113.4');
        expect(clientAddress(headers({}), 1)).toBe(UNATTRIBUTED_CLIENT_ADDRESS);
    });
});

describe('trustedProxyHops', () => {
    it('defaults to the single Nginx hop', () => {
        expect(trustedProxyHops(undefined)).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
        expect(trustedProxyHops('')).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
    });

    it('accepts a configured hop count', () => {
        expect(trustedProxyHops('2')).toBe(2);
    });

    it('fails loudly on a value that would silently mis-key the limiter', () => {
        expect(() => trustedProxyHops('0')).toThrow(/TRUSTED_PROXY_HOPS/);
        expect(() => trustedProxyHops('-1')).toThrow(/TRUSTED_PROXY_HOPS/);
        expect(() => trustedProxyHops('1.5')).toThrow(/TRUSTED_PROXY_HOPS/);
        expect(() => trustedProxyHops('all')).toThrow(/TRUSTED_PROXY_HOPS/);
    });
});

describe('a misconfigured hop count', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('keys everything into one bucket instead of failing the login request', () => {
        vi.stubEnv('TRUSTED_PROXY_HOPS', 'all');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Not a thrown error: a typo in an env var must not lock every attendee
        // out of the event, and must not fall back to trusting the header.
        const address = clientAddress(headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }));

        expect(address).toBe(UNATTRIBUTED_CLIENT_ADDRESS);
        expect(warn).toHaveBeenCalled();
        expect(String(warn.mock.calls[0][0])).toContain('TRUSTED_PROXY_HOPS');
    });

    it('reads the configured value when it is valid', () => {
        vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
        expect(clientAddress(headers({ 'x-forwarded-for': '198.51.100.7, 172.70.1.1' }))).toBe('198.51.100.7');
    });
});
