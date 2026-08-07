import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    getEarlyBirdAccess: vi.fn(),
}));

vi.mock('next/headers', () => ({
    cookies: vi.fn(),
    headers: vi.fn(),
}));
vi.mock('@/lib/early-birds/auth', () => ({
    currentEarlyBirdSession: mocks.currentEarlyBirdSession,
    earlyBirdOAuthAvailability: vi.fn(),
}));
vi.mock('@/lib/early-birds/membership', () => ({
    getEarlyBirdAccess: mocks.getEarlyBirdAccess,
}));

import EarlyBirdHome from '@/components/early-birds/EarlyBirdHome';
import EarlyBirdsPage from '../page';

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('EarlyBird Listener page', () => {
    it('renders the Listener directly without auth or membership in Free for All mode', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '1');
        vi.stubEnv('EARLY_BIRDS_DROPIN_EN_PATH', '/media/drop-ins/amara.m4a');

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.type).toBe(EarlyBirdHome);
        expect(result.props).toMatchObject({
            publicAccess: true,
            displayName: '',
            membershipSource: null,
            dropIns: { es: null, en: '/api/early-birds/drop-ins/en' },
        });
        expect(mocks.currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(mocks.getEarlyBirdAccess).not.toHaveBeenCalled();
    });
});
