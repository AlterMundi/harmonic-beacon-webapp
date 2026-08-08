import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

// Better Auth is stubbed at the module boundary currentEarlyBirdSession
// actually imports: the resolver under test crosses the real session-cookie
// inspector, observability recording and fail-closed path, with no database
// or network involved.
vi.mock('better-auth/minimal', () => ({
    betterAuth: () => ({ api: { getSession: mocks.getSession }, options: {} }),
}));
vi.mock('better-auth/adapters/prisma', () => ({ prismaAdapter: () => ({}) }));
vi.mock('better-auth/cookies', () => ({
    getCookies: () => ({
        sessionToken: {
            name: '__Secure-hb_earlybird_session',
            attributes: { path: '/', httpOnly: true, sameSite: 'lax', secure: true },
        },
    }),
}));
vi.mock('@/lib/db', () => ({ prisma: {} }));

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { listenerSessionCookieNames } from '@/lib/listener/session-cookie-bridge';
import { snapshotListenerSessionCookieObservations } from '@/lib/listener/session-cookie-observability';
import * as observability from '@/lib/listener/session-cookie-observability';

const NAMES = listenerSessionCookieNames('__Secure-hb_earlybird_session');
const VALUE = 'm1V0k2NlR3JlVG9rZW4.x%2B9ab%2Fcd%3D';

describe('currentEarlyBirdSession session-cookie observation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSession.mockResolvedValue(null);
    });

    it('records exactly one observation per resolver invocation', async () => {
        const before = snapshotListenerSessionCookieObservations();

        // Forwarded state: Better Auth runs (stubbed) and the fail-closed
        // null shape is unchanged.
        await expect(currentEarlyBirdSession(new Headers({
            host: 'listen.harmonicbeacon.com',
            cookie: `${NAMES.legacy}=${VALUE}`,
        }))).resolves.toBeNull();
        expect(mocks.getSession).toHaveBeenCalledOnce();

        // Rejected state: fails closed before Better Auth, still one observation.
        await expect(currentEarlyBirdSession(new Headers({
            host: 'listen.harmonicbeacon.com',
            cookie: `${NAMES.canonical}=${VALUE}`,
        }))).resolves.toBeNull();
        expect(mocks.getSession).toHaveBeenCalledOnce();

        const after = snapshotListenerSessionCookieObservations();
        expect(after.counts.legacy_only - before.counts.legacy_only).toBe(1);
        expect(after.counts.canonical_only - before.counts.canonical_only).toBe(1);
        expect(after.startedAtSeconds).toBe(before.startedAtSeconds);
    });

    it('preserves the resolver result byte-for-byte when Better Auth answers', async () => {
        const expiresAt = new Date('2026-09-01T00:00:00.000Z');
        mocks.getSession.mockResolvedValue({
            user: { id: 'user-1', name: 'Listener', email: 'listener@example.test', image: null },
            session: { id: 'session-1', expiresAt },
        });
        await expect(currentEarlyBirdSession(new Headers({
            host: 'listen.harmonicbeacon.com',
            cookie: `${NAMES.canonical}=${VALUE}; ${NAMES.legacy}=${VALUE}`,
        }))).resolves.toEqual({
            user: { id: 'user-1', name: 'Listener', email: 'listener@example.test', image: null },
            session: { id: 'session-1', expiresAt },
        });
    });

    it('does not count staging resolver invocations', async () => {
        const before = snapshotListenerSessionCookieObservations();
        await expect(currentEarlyBirdSession(new Headers({
            host: 'earlybirds-staging.harmonicbeacon.com',
            cookie: `${NAMES.legacy}=${VALUE}`,
        }))).resolves.toBeNull();
        expect(snapshotListenerSessionCookieObservations().counts).toEqual(before.counts);
    });

    it('keeps accepted and rejected resolver behavior unchanged if observation throws', async () => {
        const expiresAt = new Date('2026-09-01T00:00:00.000Z');
        const session = {
            user: { id: 'user-1', name: 'Listener', email: 'listener@example.test', image: null },
            session: { id: 'session-1', expiresAt },
        };
        mocks.getSession.mockResolvedValue(session);
        const spy = vi
            .spyOn(observability, 'recordListenerSessionCookieObservation')
            .mockImplementation(() => {
                throw new Error('observer down');
            });
        try {
            await expect(currentEarlyBirdSession(new Headers({
                host: 'listen.harmonicbeacon.com',
                cookie: `${NAMES.legacy}=${VALUE}`,
            }))).resolves.toEqual(session);
            expect(mocks.getSession).toHaveBeenCalledOnce();

            await expect(currentEarlyBirdSession(new Headers({
                host: 'listen.harmonicbeacon.com',
                cookie: `${NAMES.canonical}=${VALUE}`,
            }))).resolves.toBeNull();
            expect(mocks.getSession).toHaveBeenCalledOnce();
            expect(spy).toHaveBeenCalledTimes(2);
        } finally {
            spy.mockRestore();
        }
    });
});
