import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    earlyBirdOAuthAvailability: vi.fn(),
    earlyBirdMagicLinkAvailable: vi.fn(),
    getEarlyBirdListeningAccess: vi.fn(),
    cookies: vi.fn(),
    headers: vi.fn(),
}));

vi.mock('next/headers', () => ({
    cookies: mocks.cookies,
    headers: mocks.headers,
}));
vi.mock('@/lib/early-birds/auth', () => ({
    currentEarlyBirdSession: mocks.currentEarlyBirdSession,
    earlyBirdOAuthAvailability: mocks.earlyBirdOAuthAvailability,
}));
vi.mock('@/lib/early-birds/magic-link', () => ({
    earlyBirdMagicLinkAvailable: mocks.earlyBirdMagicLinkAvailable,
}));
vi.mock('@/lib/early-birds/access', () => ({
    getEarlyBirdListeningAccess: mocks.getEarlyBirdListeningAccess,
}));

import EarlyBirdHome from '@/components/early-birds/EarlyBirdHome';
import EarlyBirdsPage from '../page';

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

const inactiveFreeWindow = {
    configured: true,
    active: false,
    timeZone: 'UTC',
    localStartMinute: 600,
    selectedAt: new Date('2026-08-01T00:00:00.000Z'),
    changeAllowedAt: new Date('2026-08-08T00:00:00.000Z'),
    canChange: false,
    activeStart: null,
    activeEnd: null,
    nextStart: new Date('2026-08-08T10:00:00.000Z'),
    nextEnd: new Date('2026-08-08T12:00:00.000Z'),
};

const unusedWelcome = {
    available: true,
    active: false,
    used: false,
    startedAt: null,
    endsAt: null,
};

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
            membership: { kind: 'none', state: 'none' },
            dropIns: { es: null, en: '/api/early-birds/drop-ins/en' },
        });
        expect(mocks.currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(mocks.getEarlyBirdListeningAccess).not.toHaveBeenCalled();
    });

    it('passes the campfire fixture only behind the exact server-side prototype flag', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '1');
        vi.stubEnv('LISTENER_CAMPFIRE_PROTOTYPE', '1');
        vi.stubEnv('LISTENER_CAMPFIRE_FIXTURE', 'near');

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.type).toBe(EarlyBirdHome);
        expect(result.props).toMatchObject({
            campfirePrototype: true,
            campfireFixture: 'near',
        });
    });

    it('renders an authenticated Listener during an active Free window', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
        mocks.headers.mockResolvedValue(new Headers());
        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1', name: 'Nico' } });
        mocks.getEarlyBirdListeningAccess.mockResolvedValue({
            allowed: true,
            kind: 'free-window',
            membership: { allowed: false, projection: null },
            freeWindow: { ...inactiveFreeWindow, active: true },
            welcome: { ...unusedWelcome, available: false },
            allowedUntil: new Date('2026-08-07T17:30:00.000Z'),
        });

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.type).toBe(EarlyBirdHome);
        expect(result.props).toMatchObject({
            displayName: 'Nico',
            membership: { kind: 'none', state: 'none' },
            accessKind: 'free-window',
        });
    });

    it('derives a sanitized Founder presentation on the server', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
        mocks.headers.mockResolvedValue(new Headers());
        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1', name: 'Nico' } });
        mocks.getEarlyBirdListeningAccess.mockResolvedValue({
            allowed: true,
            kind: 'membership',
            membership: {
                allowed: true,
                projection: {
                    state: 'CANCELLED_PENDING_END',
                    source: 'MERCADO_PAGO',
                    offerCode: 'EARLY_BIRDS_FOUNDERS_V1',
                    synthetic: false,
                    provider: 'internal-provider-value',
                    reasonCode: 'PRIVATE_REASON',
                },
            },
            freeWindow: inactiveFreeWindow,
            welcome: { ...unusedWelcome, available: false },
            allowedUntil: new Date('2026-08-31T00:00:00.000Z'),
        });

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.type).toBe(EarlyBirdHome);
        expect(result.props.membership).toEqual({
            kind: 'founder',
            provider: 'mercado-pago',
            state: 'ending',
        });
        expect(JSON.stringify(result.props.membership)).not.toMatch(/PRIVATE_REASON|internal-provider-value|MERCADO_PAGO/);
    });

    it('shows the saved schedule rather than fabricating membership outside the window', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
        mocks.headers.mockResolvedValue(new Headers());
        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1', name: 'Nico' } });
        mocks.earlyBirdOAuthAvailability.mockReturnValue({ google: true, apple: false });
        mocks.earlyBirdMagicLinkAvailable.mockReturnValue(true);
        mocks.getEarlyBirdListeningAccess.mockResolvedValue({
            allowed: false,
            kind: 'denied',
            membership: { allowed: false, projection: null },
            freeWindow: inactiveFreeWindow,
            welcome: { ...unusedWelcome, available: false },
        });

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.props).toMatchObject({
            signedIn: true,
            entitled: false,
            providers: { google: true, apple: false },
            emailMagicLinkAvailable: true,
            freeWindow: {
                configured: true,
                active: false,
                nextStart: '2026-08-08T10:00:00.000Z',
            },
            welcome: expect.objectContaining({ available: false }),
        });
    });

    it('renders the Listener during the one-time welcome session', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
        mocks.headers.mockResolvedValue(new Headers());
        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1', name: 'Nico' } });
        mocks.getEarlyBirdListeningAccess.mockResolvedValue({
            allowed: true,
            kind: 'welcome',
            allowedUntil: new Date('2026-08-07T16:00:00.000Z'),
            membership: { allowed: false, projection: null },
            freeWindow: { ...inactiveFreeWindow, configured: false, nextStart: null, nextEnd: null },
            welcome: {
                available: false,
                active: true,
                used: true,
                startedAt: new Date('2026-08-07T15:30:00.000Z'),
                endsAt: new Date('2026-08-07T16:00:00.000Z'),
            },
        });

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.type).toBe(EarlyBirdHome);
        expect(result.props).toMatchObject({
            accessKind: 'welcome',
            accessUntil: '2026-08-07T16:00:00.000Z',
        });
    });
});
