import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    getEarlyBirdListeningAccess: vi.fn(),
}));
vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession: mocks.currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/access', () => ({
    getEarlyBirdListeningAccess: mocks.getEarlyBirdListeningAccess,
    serializeEarlyBirdListeningAccess: (access: Record<string, unknown>) => ({
        allowed: access.allowed,
        kind: access.kind,
        allowedUntil: (access.allowedUntil as Date | null)?.toISOString() ?? null,
        quota: access.quota,
    }),
}));
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
            kind: 'free-quota',
            allowedUntil: null,
            membership: { allowed: false, projection: null },
            quota: { policy: 'personal-7-day-v1', status: 'not-started' },
            serverNow: new Date('2026-08-07T15:31:00.000Z'),
        });

        const response = await GET(request);
        const payload = await response.json();

        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(payload).toMatchObject({
            serverNow: '2026-08-07T15:31:00.000Z',
            access: { kind: 'free-quota', allowedUntil: null },
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
