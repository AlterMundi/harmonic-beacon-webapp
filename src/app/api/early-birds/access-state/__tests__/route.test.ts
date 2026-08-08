import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    getEarlyBirdListeningAccess: vi.fn(),
}));
vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession: mocks.currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/access', () => ({
    getEarlyBirdListeningAccess: mocks.getEarlyBirdListeningAccess,
}));

import { freeWindowState } from '@/lib/early-birds/free-window';
import { welcomeAccessState } from '@/lib/early-birds/welcome-access';
import { GET } from '../route';

const request = new NextRequest('https://listen.harmonicbeacon.com/api/early-birds/access-state');

describe('Listener access-state API', () => {
    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
    });

    it('returns only private server-authoritative boundary state', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        mocks.getEarlyBirdListeningAccess.mockResolvedValue({
            allowed: true,
            kind: 'welcome',
            allowedUntil: new Date('2026-08-07T16:00:00.000Z'),
            membership: { allowed: false, projection: null },
            freeWindow: freeWindowState(null),
            welcome: welcomeAccessState({
                accountId: 'listener-1',
                startedAt: new Date('2026-08-07T15:30:00.000Z'),
                endsAt: new Date('2026-08-07T16:00:00.000Z'),
                activationRequestId: crypto.randomUUID(),
                createdAt: new Date('2026-08-07T15:30:00.000Z'),
                updatedAt: new Date('2026-08-07T15:30:00.000Z'),
            }, new Date('2026-08-07T15:31:00.000Z')),
        });

        const response = await GET(request);
        const payload = await response.json();

        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(payload).toMatchObject({
            access: { kind: 'welcome', allowedUntil: '2026-08-07T16:00:00.000Z' },
            welcome: { active: true },
        });
        expect(JSON.stringify(payload)).not.toContain('listener-1');
    });

    it('requires a Listener session', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        mocks.currentEarlyBirdSession.mockResolvedValue(null);
        expect((await GET(request)).status).toBe(401);
        expect(mocks.getEarlyBirdListeningAccess).not.toHaveBeenCalled();
    });
});
