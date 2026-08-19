import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => ({
    findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: { listenerAccountSession: sessions } }));

import {
    currentListenerAccountSession,
    LISTENER_ACCOUNT_COOKIE,
    listenerAccountRPConfig,
    locallyKnownListenerNavigationIdentity,
    locallyKnownListenerAccountSession,
    localListenerAccountId,
    readListenerAccountCookie,
    readListenerAccountAttemptCookie,
} from '@/lib/listener/account-rp';

describe('Listener Account host-bound secret selection', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('loads only production secrets on the production host', () => {
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENABLED', '1');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'production');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET', 'p'.repeat(32));
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_STATE_SECRET', 'a'.repeat(32));
        expect(listenerAccountRPConfig(new Headers({ host: 'listen.harmonicbeacon.com' })))
            .toMatchObject({ issuer: 'https://account.harmonicbeacon.com', clientId: 'hb-listener' });
        expect(() => listenerAccountRPConfig(new Headers({
            host: 'earlybirds-staging.harmonicbeacon.com',
        }))).toThrow(/environment mismatch/);
    });

    it('loads only staging secrets and rejects cross-environment material', () => {
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENABLED', '1');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'staging');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING', 's'.repeat(32));
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING', 'b'.repeat(32));
        expect(listenerAccountRPConfig(new Headers({
            host: 'earlybirds-staging.harmonicbeacon.com',
        }))).toMatchObject({
            issuer: 'https://account-staging.harmonicbeacon.com', clientId: 'hb-listener-staging',
        });
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET', 'p'.repeat(32));
        expect(() => listenerAccountRPConfig(new Headers({
            host: 'earlybirds-staging.harmonicbeacon.com',
        }))).toThrow(/other environment/);
    });
});

describe('Listener Account RP subject namespace', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('accepts exactly one bounded cookie and fails malformed or duplicate cookies closed', () => {
        expect(readListenerAccountCookie(new Headers({
            cookie: `${LISTENER_ACCOUNT_COOKIE}=opaque%2Dtoken`,
        }))).toBe('opaque-token');
        expect(readListenerAccountCookie(new Headers({
            cookie: `${LISTENER_ACCOUNT_COOKIE}=%`,
        }))).toBeNull();
        expect(readListenerAccountCookie(new Headers({
            cookie: `${LISTENER_ACCOUNT_COOKIE}=first; ${LISTENER_ACCOUNT_COOKIE}=second`,
        }))).toBeNull();
        expect(readListenerAccountCookie(new Headers({
            cookie: `${LISTENER_ACCOUNT_COOKIE}=${'a'.repeat(513)}`,
        }))).toBeNull();
        expect(readListenerAccountAttemptCookie(new Headers({
            cookie: '__Host-hb_listener_account_attempt=%',
        }))).toBeNull();
        expect(readListenerAccountAttemptCookie(new Headers({
            cookie: '__Host-hb_listener_account_attempt=one; __Host-hb_listener_account_attempt=two',
        }))).toBeNull();
    });

    it('preserves production opaque account IDs for existing commercial foreign keys', () => {
        expect(localListenerAccountId('https://account.harmonicbeacon.com', 'opaque-account'))
            .toBe('opaque-account');
    });

    it('materializes the same staging subject into a distinct deterministic account', () => {
        const prod = localListenerAccountId('https://account.harmonicbeacon.com', 'same-sub');
        const staging = localListenerAccountId('https://account-staging.harmonicbeacon.com', 'same-sub');
        expect(staging).toMatch(/^acct_stg_[A-Za-z0-9_-]{43}$/);
        expect(staging).not.toBe(prod);
        expect(localListenerAccountId('https://account-staging.harmonicbeacon.com', 'same-sub'))
            .toBe(staging);
    });

    it('derives the navigation hint from an exact unexpired local session without network or writes', async () => {
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENABLED', '1');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'staging');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING', 's'.repeat(32));
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING', 'b'.repeat(32));
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const now = new Date('2026-08-18T12:00:00.000Z');
        sessions.findUnique.mockResolvedValue({
            issuer: 'https://account-staging.harmonicbeacon.com',
            subject: 'opaque-account',
            sid: 'central-sid',
            synthetic: false,
            expiresAt: new Date('2026-08-18T12:05:00.000Z'),
            account: { name: 'Fallback name', beaconProfile: { displayName: 'Nico' } },
        });
        const headers = new Headers({
            host: 'earlybirds-staging.harmonicbeacon.com',
            cookie: `${LISTENER_ACCOUNT_COOKIE}=opaque-session-token`,
        });

        await expect(locallyKnownListenerNavigationIdentity(headers, now)).resolves.toEqual({
            displayName: 'Nico',
        });
        await expect(locallyKnownListenerAccountSession(headers, now)).resolves.toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(sessions.update).not.toHaveBeenCalled();
        expect(sessions.updateMany).not.toHaveBeenCalled();
        expect(sessions.delete).not.toHaveBeenCalled();

        sessions.findUnique.mockResolvedValueOnce({
            issuer: 'https://account-staging.harmonicbeacon.com',
            subject: 'opaque-account', sid: 'central-sid', synthetic: false,
            expiresAt: now,
        }).mockResolvedValueOnce({
            issuer: 'https://account-staging.harmonicbeacon.com',
            subject: 'opaque-account', sid: 'central-sid', synthetic: true,
            expiresAt: new Date('2026-08-18T12:05:00.000Z'),
        }).mockResolvedValueOnce({
            issuer: 'https://account.harmonicbeacon.com',
            subject: 'opaque-account', sid: 'central-sid', synthetic: false,
            expiresAt: new Date('2026-08-18T12:05:00.000Z'),
        });
        await expect(locallyKnownListenerAccountSession(headers, now)).resolves.toBe(false);
        await expect(locallyKnownListenerAccountSession(headers, now)).resolves.toBe(false);
        await expect(locallyKnownListenerAccountSession(headers, now)).resolves.toBe(false);
    });
});

describe('Listener Account outage boundary', () => {
    beforeEach(() => {
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET', 'listener-secret-with-at-least-32-characters');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_STATE_SECRET', 'listener-state-secret-with-at-least-32-characters');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENABLED', '1');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'production');
        sessions.findUnique.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000001',
            issuer: 'https://account.harmonicbeacon.com',
            subject: 'opaque-account', sid: 'central-sid', accountId: 'opaque-account',
            expiresAt: new Date(Date.now() + 60_000),
            lastCheckedAt: new Date(Date.now() - 10 * 60_000),
            account: { id: 'opaque-account', name: 'Listener', email: 'opaque@account.invalid',
                image: null, beaconProfile: { displayName: 'Listener' } },
        });
        sessions.updateMany.mockResolvedValue({ count: 1 });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Account unavailable')));
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    const headers = () => new Headers({
        host: 'listen.harmonicbeacon.com',
        cookie: `${LISTENER_ACCOUNT_COOKIE}=opaque-session-token`,
    });

    it('fails new identity/authorization decisions closed when revalidation is overdue', async () => {
        await expect(currentListenerAccountSession(headers())).resolves.toBeNull();
        expect(sessions.delete).not.toHaveBeenCalled();
    });

    it('coalesces overdue revalidation and never treats the lease as success', async () => {
        const base = {
            id: '00000000-0000-4000-8000-000000000001',
            issuer: 'https://account.harmonicbeacon.com', subject: 'opaque-account',
            sid: 'central-sid', accountId: 'opaque-account',
            expiresAt: new Date(Date.now() + 60_000),
            lastCheckedAt: new Date(Date.now() - 10 * 60_000),
            account: { id: 'opaque-account', name: 'Listener', email: 'opaque@account.invalid',
                image: null, beaconProfile: { displayName: 'Listener' } },
        };
        sessions.findUnique
            .mockReset()
            .mockResolvedValueOnce(base)
            .mockResolvedValueOnce(base)
            .mockResolvedValueOnce({ ...base, lastCheckedAt: new Date() });
        sessions.updateMany.mockReset()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });
        sessions.update.mockResolvedValue({ ...base, lastCheckedAt: new Date() });
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            active: true, iss: base.issuer, sub: base.subject, sid: base.sid,
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        const results = await Promise.all([
            currentListenerAccountSession(headers()),
            currentListenerAccountSession(headers()),
        ]);
        expect(results.every(Boolean)).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
