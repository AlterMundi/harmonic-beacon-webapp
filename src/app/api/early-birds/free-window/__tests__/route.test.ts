import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    getEarlyBirdFreeWindow: vi.fn(),
    selectEarlyBirdFreeWindow: vi.fn(),
}));
vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession: mocks.currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/free-window', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/early-birds/free-window')>(),
    getEarlyBirdFreeWindow: mocks.getEarlyBirdFreeWindow,
    selectEarlyBirdFreeWindow: mocks.selectEarlyBirdFreeWindow,
}));

import {
    EarlyBirdFreeWindowCooldownError,
    freeWindowState,
} from '@/lib/early-birds/free-window';
import { GET, POST } from '../route';

function request(method: 'GET' | 'POST', body?: unknown, origin = 'https://listen.harmonicbeacon.com') {
    return new NextRequest('https://listen.harmonicbeacon.com/api/early-birds/free-window', {
        method,
        headers: {
            origin,
            ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

describe('Free listening schedule API', () => {
    beforeEach(() => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_AUTH_BASE_URL', 'https://listen.harmonicbeacon.com');
        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
    });
    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
    });

    it('requires an EarlyBird session for reads', async () => {
        mocks.currentEarlyBirdSession.mockResolvedValue(null);
        expect((await GET(request('GET'))).status).toBe(401);
        expect(mocks.getEarlyBirdFreeWindow).not.toHaveBeenCalled();
    });

    it('rejects cross-origin mutations before touching account state', async () => {
        const response = await POST(request('POST', {}, 'https://attacker.invalid'));
        expect(response.status).toBe(403);
        expect(mocks.currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(mocks.selectEarlyBirdFreeWindow).not.toHaveBeenCalled();
    });

    it('selects a validated server-authoritative window and returns no-store state', async () => {
        const state = freeWindowState(null);
        mocks.selectEarlyBirdFreeWindow.mockResolvedValue({ state, replayed: false });
        const response = await POST(request('POST', {
            mode: 'now',
            timeZone: 'America/Argentina/Cordoba',
            selectionRequestId: '00000000-0000-4000-8000-000000000001',
        }));

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(mocks.selectEarlyBirdFreeWindow).toHaveBeenCalledWith(expect.objectContaining({
            accountId: 'listener-1',
            mode: 'now',
            timeZone: 'America/Argentina/Cordoba',
        }));
    });

    it('reports the canonical cooldown boundary on conflicting retries', async () => {
        const boundary = new Date('2026-08-14T15:30:00.000Z');
        mocks.selectEarlyBirdFreeWindow.mockRejectedValue(new EarlyBirdFreeWindowCooldownError(boundary));
        const response = await POST(request('POST', {
            mode: 'custom',
            timeZone: 'UTC',
            localStartMinute: 600,
            selectionRequestId: '00000000-0000-4000-8000-000000000002',
        }));

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ changeAllowedAt: boundary.toISOString() });
    });
});
