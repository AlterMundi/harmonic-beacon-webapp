import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    getEarlyBirdListeningAccess: vi.fn(),
    startEarlyBirdWelcomeAccess: vi.fn(),
}));
vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession: mocks.currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/access', () => ({
    getEarlyBirdListeningAccess: mocks.getEarlyBirdListeningAccess,
}));
vi.mock('@/lib/early-birds/welcome-access', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/early-birds/welcome-access')>(),
    startEarlyBirdWelcomeAccess: mocks.startEarlyBirdWelcomeAccess,
}));

import { welcomeAccessState } from '@/lib/early-birds/welcome-access';
import { POST } from '../route';

function request(body: unknown, origin = 'https://listen.harmonicbeacon.com') {
    return new NextRequest('https://listen.harmonicbeacon.com/api/early-birds/welcome-access', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('first-listen welcome API', () => {
    beforeEach(() => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        vi.stubEnv('EARLY_BIRDS_AUTH_BASE_URL', 'https://listen.harmonicbeacon.com');
        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
    });
    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
    });

    it('requires same-origin authenticated explicit activation', async () => {
        expect((await POST(request({}, 'https://attacker.invalid'))).status).toBe(403);
        expect(mocks.currentEarlyBirdSession).not.toHaveBeenCalled();

        mocks.currentEarlyBirdSession.mockResolvedValue(null);
        expect((await POST(request({ activationRequestId: crypto.randomUUID() }))).status).toBe(401);
        expect(mocks.startEarlyBirdWelcomeAccess).not.toHaveBeenCalled();
    });

    it('does not consume welcome access while Free for All is active', async () => {
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '1');
        const response = await POST(request({ activationRequestId: crypto.randomUUID() }));

        expect(response.status).toBe(409);
        expect(mocks.currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(mocks.startEarlyBirdWelcomeAccess).not.toHaveBeenCalled();
    });

    it('starts through the durable idempotent command and returns private state', async () => {
        const activationRequestId = crypto.randomUUID();
        const active = {
            accountId: 'listener-1',
            startedAt: new Date('2026-08-07T15:30:00.000Z'),
            endsAt: new Date('2026-08-07T16:00:00.000Z'),
            activationRequestId,
            createdAt: new Date('2026-08-07T15:30:00.000Z'),
            updatedAt: new Date('2026-08-07T15:30:00.000Z'),
        };
        mocks.startEarlyBirdWelcomeAccess.mockResolvedValue({
            access: active,
            state: welcomeAccessState(active, new Date('2026-08-07T15:31:00.000Z')),
            replayed: false,
        });

        const response = await POST(request({ activationRequestId }));

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(mocks.startEarlyBirdWelcomeAccess).toHaveBeenCalledWith({
            accountId: 'listener-1',
            activationRequestId,
        });
        expect(await response.json()).toMatchObject({
            state: { active: true, endsAt: '2026-08-07T16:00:00.000Z' },
        });
    });
});
