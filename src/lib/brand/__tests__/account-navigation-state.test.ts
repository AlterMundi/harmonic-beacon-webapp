import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { digestSessionToken } from '@/lib/session-auth';

const findUnique = vi.fn();

vi.mock('@/lib/db', () => ({
    prisma: {
        webSession: { findUnique },
    },
}));

const NOW = new Date('2026-08-18T12:00:00.000Z');
const TOKEN = 'a'.repeat(43);
const ISSUER = 'https://account-staging.harmonicbeacon.com';

function requestHeaders(cookie = `hb_session=${TOKEN}`): Headers {
    return new Headers({ cookie });
}

function localSession(overrides: Record<string, unknown> = {}) {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        expiresAt: new Date(NOW.getTime() + 60_000),
        revokedAt: null,
        accountIssuer: ISSUER,
        accountSubject: 'account-subject-opaque',
        accountSessionId: 'account-session-opaque',
        accountValidatedAt: new Date(NOW.getTime() - 60_000),
        ...overrides,
    };
}

beforeEach(() => {
    vi.resetAllMocks();
    process.env.BEACON_ACCOUNT_ENABLED = 'true';
    process.env.BEACON_ACCOUNT_ISSUER_URL = ISSUER;
    process.env.BEACON_ACCOUNT_CLIENT_ID = 'hb-live-staging';
    process.env.BEACON_ACCOUNT_CLIENT_SECRET = 'staging-test-secret-longer-than-thirty-two-characters';
});

afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BEACON_ACCOUNT_ENABLED;
    delete process.env.BEACON_ACCOUNT_ISSUER_URL;
    delete process.env.BEACON_ACCOUNT_CLIENT_ID;
    delete process.env.BEACON_ACCOUNT_CLIENT_SECRET;
});

describe('local Account navigation state', () => {
    it('returns only a boolean from a valid local Live session without backchannel or mutation', async () => {
        findUnique.mockResolvedValue(localSession());
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const { locallyKnownLiveAccountSession } = await import('../account-navigation-state');

        await expect(locallyKnownLiveAccountSession(requestHeaders(), NOW)).resolves.toBe(true);
        expect(findUnique).toHaveBeenCalledWith({
            where: { tokenDigest: digestSessionToken(TOKEN) },
            select: {
                id: true,
                expiresAt: true,
                revokedAt: true,
                accountIssuer: true,
                accountSubject: true,
                accountSessionId: true,
                accountValidatedAt: true,
            },
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(findUnique.mock.calls[0][0].select).not.toHaveProperty('accountDisplayName');
    });

    it.each([
        ['', 'missing'],
        [`other=x; hb_session=${TOKEN}; hb_session=${TOKEN}`, 'duplicate'],
        ['hb_session=short', 'malformed'],
        [`hb_session=${'a'.repeat(43)}%0A`, 'encoded malformed'],
    ])('fails neutral before the database for a %s cookie (%s)', async (cookie) => {
        const { locallyKnownLiveAccountSession } = await import('../account-navigation-state');

        await expect(locallyKnownLiveAccountSession(requestHeaders(cookie), NOW)).resolves.toBe(false);
        expect(findUnique).not.toHaveBeenCalled();
    });

    it.each([
        ['unknown', null],
        ['expired', localSession({ expiresAt: NOW })],
        ['revoked', localSession({ revokedAt: NOW })],
        ['wrong issuer', localSession({ accountIssuer: 'https://account.harmonicbeacon.com' })],
        ['missing subject', localSession({ accountSubject: null })],
        ['malformed subject', localSession({ accountSubject: 'has a space' })],
        ['missing sid', localSession({ accountSessionId: null })],
    ])('does not show signed-in state for a %s local record', async (_label, row) => {
        findUnique.mockResolvedValue(row);
        const { locallyKnownLiveAccountSession } = await import('../account-navigation-state');

        await expect(locallyKnownLiveAccountSession(requestHeaders(), NOW)).resolves.toBe(false);
    });

    it('fails neutral when Account is disabled or local storage/configuration is unavailable', async () => {
        const { locallyKnownLiveAccountSession } = await import('../account-navigation-state');
        process.env.BEACON_ACCOUNT_ENABLED = 'false';
        await expect(locallyKnownLiveAccountSession(requestHeaders(), NOW)).resolves.toBe(false);
        expect(findUnique).not.toHaveBeenCalled();

        process.env.BEACON_ACCOUNT_ENABLED = 'true';
        findUnique.mockRejectedValue(new Error('database unavailable'));
        await expect(locallyKnownLiveAccountSession(requestHeaders(), NOW)).resolves.toBe(false);
    });
});
