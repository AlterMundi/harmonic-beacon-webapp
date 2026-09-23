import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { digestSessionToken } from '@/lib/session-auth';

const findUnique = vi.fn();
const findBinding = vi.fn();

vi.mock('@/lib/db', () => ({
    prisma: {
        webSession: { findUnique },
        staffAccountBinding: { findUnique: findBinding },
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
        accountDisplayName: 'Nicolás',
        accountValidatedAt: new Date(NOW.getTime() - 60_000),
        staffUser: null,
        ...overrides,
    };
}

beforeEach(() => {
    vi.resetAllMocks();
    findBinding.mockResolvedValue(null);
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
    it('returns minimum local presentation without backchannel or mutation', async () => {
        findUnique.mockResolvedValue(localSession());
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const {
            locallyKnownLiveAccountSession,
            locallyKnownLiveNavigationIdentity,
        } = await import('../account-navigation-state');

        await expect(locallyKnownLiveNavigationIdentity(requestHeaders(), NOW)).resolves.toEqual({
            issuer: ISSUER,
            displayName: 'Nicolás',
            staffRole: null,
            availableStaffRole: null,
        });
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
                accountDisplayName: true,
                accountValidatedAt: true,
                staffUser: {
                    select: {
                        role: true,
                        disabledAt: true,
                        accountBinding: {
                            select: {
                                accountIssuer: true,
                                accountSubject: true,
                                disabledAt: true,
                            },
                        },
                    },
                },
            },
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(findUnique.mock.calls[0][0].select).not.toHaveProperty('email');
        expect(findUnique.mock.calls[0][0].select).not.toHaveProperty('tokenDigest');
    });

    it('exposes only a local staff shortcut when the active binding still matches', async () => {
        findUnique.mockResolvedValue(localSession({
            staffUser: {
                role: 'ADMIN',
                disabledAt: null,
                accountBinding: {
                    accountIssuer: ISSUER,
                    accountSubject: 'account-subject-opaque',
                    disabledAt: null,
                },
            },
        }));
        const { locallyKnownLiveNavigationIdentity } = await import('../account-navigation-state');

        await expect(locallyKnownLiveNavigationIdentity(requestHeaders(), NOW)).resolves.toEqual({
            issuer: ISSUER,
            displayName: 'Nicolás',
            staffRole: 'ADMIN',
            availableStaffRole: 'ADMIN',
        });
    });

    it.each([
        ['disabled staff', { role: 'ADMIN', disabledAt: NOW, accountBinding: null }],
        ['disabled binding', { role: 'ADMIN', disabledAt: null, accountBinding: { accountIssuer: ISSUER, accountSubject: 'account-subject-opaque', disabledAt: NOW } }],
        ['wrong binding', { role: 'ADMIN', disabledAt: null, accountBinding: { accountIssuer: ISSUER, accountSubject: 'other-subject', disabledAt: null } }],
    ])('keeps Account signed in but withholds Operations for %s', async (_label, staffUser) => {
        findUnique.mockResolvedValue(localSession({ staffUser }));
        const { locallyKnownLiveNavigationIdentity } = await import('../account-navigation-state');

        await expect(locallyKnownLiveNavigationIdentity(requestHeaders(), NOW)).resolves.toEqual({
            issuer: ISSUER,
            displayName: 'Nicolás',
            staffRole: null,
            availableStaffRole: null,
        });
    });

    it('discovers a participant-mode admin by issuer/subject without granting staff mode', async () => {
        findUnique.mockResolvedValue(localSession());
        findBinding.mockResolvedValue({ disabledAt: null, staffUser: { role: 'ADMIN', disabledAt: null } });
        const { locallyKnownLiveNavigationIdentity } = await import('../account-navigation-state');
        await expect(locallyKnownLiveNavigationIdentity(requestHeaders(), NOW)).resolves.toEqual({
            issuer: ISSUER, displayName: 'Nicolás', staffRole: null, availableStaffRole: 'ADMIN',
        });
        expect(findBinding).toHaveBeenCalledWith({
            where: { accountIssuer_accountSubject: { accountIssuer: ISSUER, accountSubject: 'account-subject-opaque' } },
            select: { disabledAt: true, staffUser: { select: { role: true, disabledAt: true } } },
        });
    });

    it.each([
        { disabledAt: NOW, staffUser: { role: 'ADMIN', disabledAt: null } },
        { disabledAt: null, staffUser: { role: 'ADMIN', disabledAt: NOW } },
    ])('withholds the shortcut when the available binding or staff is disabled', async binding => {
        findUnique.mockResolvedValue(localSession());
        findBinding.mockResolvedValue(binding);
        const { locallyKnownLiveNavigationIdentity } = await import('../account-navigation-state');
        expect((await locallyKnownLiveNavigationIdentity(requestHeaders(), NOW))?.availableStaffRole).toBeNull();
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
