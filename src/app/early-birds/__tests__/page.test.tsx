import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    earlyBirdOAuthAvailability: vi.fn(),
    earlyBirdMagicLinkAvailable: vi.fn(),
    getEarlyBirdListeningAccess: vi.fn(),
    headers: vi.fn(),
}));

vi.mock('next/headers', () => ({
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
import {
    EARLY_BIRD_INVITATION_COOKIE,
    LISTENER_INVITATION_COOKIE,
} from '@/lib/early-birds/invitation-cookie';
import EarlyBirdsPage from '../page';

const INVITATION = `ebi_v1.${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`;

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

const availableQuota = {
    policy: 'personal-7-day-v1' as const,
    status: 'not-started' as const,
    cycleStartedAt: null,
    cycleEndsAt: null,
    baseAllowanceMs: 10_800_000,
    bonusAllowanceMs: 0,
    consumedMs: 0,
    remainingMs: 10_800_000,
    activelyConsuming: false,
    exhaustsAt: null,
    nextCycleAt: null,
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

    it('renders an authenticated Listener immediately with the server-authoritative Free quota', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        mocks.headers.mockResolvedValue(new Headers());
        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1', name: 'Nico' } });
        mocks.getEarlyBirdListeningAccess.mockResolvedValue({
            allowed: true,
            kind: 'free-quota',
            membership: { allowed: false, projection: null },
            quota: availableQuota,
            allowedUntil: null,
            serverNow: new Date('2026-08-08T15:00:00.000Z'),
        });

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.type).toBe(EarlyBirdHome);
        expect(result.props).toMatchObject({
            displayName: 'Nico',
            membership: { kind: 'none', state: 'none' },
            accessKind: 'free-quota',
            quota: expect.objectContaining({ remainingMs: 10_800_000 }),
            serverNow: '2026-08-08T15:00:00.000Z',
        });
    });

    it('derives a sanitized Founder presentation on the server', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
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
            quota: null,
            allowedUntil: new Date('2026-08-31T00:00:00.000Z'),
            serverNow: new Date('2026-08-08T15:00:00.000Z'),
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

    it('shows exhausted quota rather than fabricating membership', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        mocks.headers.mockResolvedValue(new Headers());
        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1', name: 'Nico' } });
        mocks.earlyBirdOAuthAvailability.mockReturnValue({ google: true, apple: false });
        mocks.earlyBirdMagicLinkAvailable.mockReturnValue(true);
        mocks.getEarlyBirdListeningAccess.mockResolvedValue({
            allowed: false,
            kind: 'denied',
            membership: { allowed: false, projection: null },
            quota: {
                ...availableQuota,
                status: 'exhausted',
                cycleStartedAt: new Date('2026-08-01T15:00:00.000Z'),
                cycleEndsAt: new Date('2026-08-08T15:00:00.000Z'),
                consumedMs: 10_800_000,
                remainingMs: 0,
                nextCycleAt: new Date('2026-08-08T15:00:00.000Z'),
            },
            serverNow: new Date('2026-08-08T14:00:00.000Z'),
        });

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.props).toMatchObject({
            signedIn: true,
            entitled: false,
            providers: { google: true, apple: false },
            emailMagicLinkAvailable: true,
            quota: expect.objectContaining({
                status: 'exhausted',
                remainingMs: 0,
            }),
            serverNow: '2026-08-08T14:00:00.000Z',
        });
    });

    it('does not fabricate Free or welcome state when identity resolution fails', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        mocks.headers.mockResolvedValue(new Headers());
        mocks.currentEarlyBirdSession.mockRejectedValue(new Error('identity unavailable'));
        mocks.earlyBirdOAuthAvailability.mockReturnValue({ google: true, apple: false });
        mocks.earlyBirdMagicLinkAvailable.mockReturnValue(false);

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.props).toMatchObject({
            signedIn: false,
            serviceUnavailable: 'identity',
            quota: null,
        });
        expect(mocks.getEarlyBirdListeningAccess).not.toHaveBeenCalled();
    });

    it('does not fabricate Free or welcome state when access resolution fails', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        mocks.headers.mockResolvedValue(new Headers());
        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1', name: 'Nico' } });
        mocks.getEarlyBirdListeningAccess.mockRejectedValue(new Error('database unavailable'));
        mocks.earlyBirdOAuthAvailability.mockReturnValue({ google: true, apple: false });
        mocks.earlyBirdMagicLinkAvailable.mockReturnValue(false);

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.props).toMatchObject({
            signedIn: true,
            serviceUnavailable: 'access',
            quota: null,
        });
    });

    it('shows identity unavailable when no public sign-in method is configured', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        mocks.headers.mockResolvedValue(new Headers());
        mocks.currentEarlyBirdSession.mockResolvedValue(null);
        mocks.earlyBirdOAuthAvailability.mockReturnValue({ google: false, apple: false });
        mocks.earlyBirdMagicLinkAvailable.mockReturnValue(false);

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.props.serviceUnavailable).toBe('identity');
    });

    it.each([
        [LISTENER_INVITATION_COOKIE],
        [EARLY_BIRD_INVITATION_COOKIE],
    ])('recognizes a valid %s invitation cookie without exposing its value', async (name) => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        mocks.headers.mockResolvedValue(new Headers({ cookie: `${name}=${INVITATION}` }));
        mocks.currentEarlyBirdSession.mockResolvedValue(null);
        mocks.earlyBirdOAuthAvailability.mockReturnValue({ google: true, apple: false });
        mocks.earlyBirdMagicLinkAvailable.mockReturnValue(false);

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.props.invitationAvailable).toBe(true);
        expect(JSON.stringify(result.props)).not.toContain(INVITATION);
    });

    it('fails closed when canonical and legacy invitation cookies conflict', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '0');
        const other = `ebi_v1.${'d'.repeat(32)}.${'e'.repeat(32)}.${'f'.repeat(32)}`;
        mocks.headers.mockResolvedValue(new Headers({
            cookie: `${LISTENER_INVITATION_COOKIE}=${other}; ${EARLY_BIRD_INVITATION_COOKIE}=${INVITATION}`,
        }));
        mocks.currentEarlyBirdSession.mockResolvedValue(null);
        mocks.earlyBirdOAuthAvailability.mockReturnValue({ google: true, apple: false });
        mocks.earlyBirdMagicLinkAvailable.mockReturnValue(false);

        const result = await EarlyBirdsPage({ searchParams: Promise.resolve({}) });

        expect(result.props.invitationAvailable).toBe(false);
    });
});
