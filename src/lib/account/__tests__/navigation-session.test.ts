import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => ({
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { earlyBirdAuthSession: sessions } }));

import { locallyKnownAccountSession } from '@/lib/account/auth';
import { ACCOUNT_SESSION_COOKIE } from '@/lib/account/config';

const secret = 'account-navigation-session-secret-at-least-32';

function cookie(token: string, signature = createHmac('sha256', secret).update(token).digest('base64')) {
    return `${ACCOUNT_SESSION_COOKIE}=${encodeURIComponent(`${token}.${signature}`)}`;
}

describe('Account navigation session hint', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('reads an exact active session without refreshing, deleting or exposing its user', async () => {
        vi.stubEnv('BEACON_ACCOUNT_AUTH_SECRET', secret);
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', 'https://account-staging.harmonicbeacon.com');
        const now = new Date('2026-08-18T12:00:00.000Z');
        sessions.findUnique.mockResolvedValue({
            expiresAt: new Date('2026-08-18T12:05:00.000Z'),
            securityRevision: 3,
            authorityEnvironment: 'staging',
            user: { securityRevision: 3 },
        });

        await expect(locallyKnownAccountSession(new Headers({
            host: 'account-staging.harmonicbeacon.com',
            cookie: cookie('opaque-session-token'),
        }), now)).resolves.toBe(true);

        expect(sessions.findUnique).toHaveBeenCalledWith({
            where: { token: 'opaque-session-token' },
            select: {
                expiresAt: true,
                securityRevision: true,
                authorityEnvironment: true,
                user: { select: { securityRevision: true } },
            },
        });
        expect(sessions.update).not.toHaveBeenCalled();
        expect(sessions.updateMany).not.toHaveBeenCalled();
        expect(sessions.delete).not.toHaveBeenCalled();
        expect(sessions.deleteMany).not.toHaveBeenCalled();
    });

    it('fails malformed, forged, duplicate, expired and revision-stale sessions closed', async () => {
        vi.stubEnv('BEACON_ACCOUNT_AUTH_SECRET', secret);
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', 'https://account-staging.harmonicbeacon.com');
        const now = new Date('2026-08-18T12:00:00.000Z');

        await expect(locallyKnownAccountSession(new Headers({
            host: 'account-staging.harmonicbeacon.com',
            cookie: `${ACCOUNT_SESSION_COOKIE}=%`,
        }), now)).resolves.toBe(false);
        await expect(locallyKnownAccountSession(new Headers({
            host: 'account-staging.harmonicbeacon.com',
            cookie: cookie('opaque-session-token', 'A'.repeat(44)),
        }), now)).resolves.toBe(false);
        await expect(locallyKnownAccountSession(new Headers({
            host: 'account-staging.harmonicbeacon.com',
            cookie: `${cookie('one')}; ${cookie('two')}`,
        }), now)).resolves.toBe(false);
        await expect(locallyKnownAccountSession(new Headers({
            host: 'account.harmonicbeacon.com',
            cookie: cookie('wrong-environment'),
        }), now)).resolves.toBe(false);
        await expect(locallyKnownAccountSession(new Headers({
            host: 'account-staging.harmonicbeacon.com',
            cookie: `${ACCOUNT_SESSION_COOKIE}=${'a'.repeat(8193)}`,
        }), now)).resolves.toBe(false);
        expect(sessions.findUnique).not.toHaveBeenCalled();

        sessions.findUnique.mockResolvedValueOnce({
            expiresAt: now,
            securityRevision: 3,
            authorityEnvironment: 'staging',
            user: { securityRevision: 3 },
        }).mockResolvedValueOnce({
            expiresAt: new Date('2026-08-18T12:05:00.000Z'),
            securityRevision: 2,
            authorityEnvironment: 'staging',
            user: { securityRevision: 3 },
        });
        await expect(locallyKnownAccountSession(new Headers({
            host: 'account-staging.harmonicbeacon.com',
            cookie: cookie('expired'),
        }), now)).resolves.toBe(false);
        await expect(locallyKnownAccountSession(new Headers({
            host: 'account-staging.harmonicbeacon.com',
            cookie: cookie('stale'),
        }), now)).resolves.toBe(false);
        expect(sessions.update).not.toHaveBeenCalled();
        expect(sessions.delete).not.toHaveBeenCalled();
    });
});
