import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    access: vi.fn(),
    checkout: vi.fn(),
    createToken: vi.fn(),
    enabled: vi.fn(),
    headers: vi.fn(),
    membership: vi.fn(),
    notFound: vi.fn(),
    redirect: vi.fn(),
    session: vi.fn(),
    workbench: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock('@/lib/early-birds/access', () => ({ getEarlyBirdListeningAccess: mocks.access }));
vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession: mocks.session }));
vi.mock('@/lib/early-birds/checkout', () => ({ listenerCheckoutAvailability: mocks.checkout }));
vi.mock('@/lib/early-birds/enabled', () => ({ earlyBirdsEnabled: mocks.enabled }));
vi.mock('@/lib/early-birds/live-workbench', () => ({
    createListenerLiveWorkbenchCsrfToken: mocks.createToken,
    listenerLiveWorkbenchConfig: mocks.workbench,
}));
vi.mock('@/lib/early-birds/membership-presentation', () => ({
    listenerMembershipPresentation: mocks.membership,
}));

import ListenerMembershipPage from '@/components/early-birds/ListenerMembershipPage';
import ListenerMembershipManagementPage from './page';

const session = {
    user: { id: 'acct_stg_user', name: 'Founder Test', email: 'founder@example.test' },
    session: { id: 'session-1', expiresAt: new Date('2026-09-01T00:00:00Z') },
};
const access = {
    allowed: true,
    kind: 'membership',
    membership: { allowed: true, projection: { opaque: 'projection' } },
    quota: null,
    serverNow: new Date('2026-08-19T00:00:00Z'),
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.mockReturnValue(true);
    mocks.headers.mockResolvedValue(new Headers({ host: 'earlybirds-staging.harmonicbeacon.com' }));
    mocks.session.mockResolvedValue(session);
    mocks.access.mockResolvedValue(access);
    mocks.checkout.mockReturnValue({ paypal: false, mercadoPago: false });
    mocks.workbench.mockReturnValue(null);
    mocks.membership.mockReturnValue({ kind: 'founder', provider: 'paypal', state: 'active' });
});

describe('Listener membership management route', () => {
    it('is available only on the exact Listener hosts', async () => {
        mocks.headers.mockResolvedValue(new Headers({ host: 'live.harmonicbeacon.com' }));
        const stopped = new Error('not-found');
        mocks.notFound.mockImplementation(() => { throw stopped; });

        await expect(ListenerMembershipManagementPage()).rejects.toBe(stopped);
        expect(mocks.session).not.toHaveBeenCalled();
    });

    it('returns a signed-out browser to Listener without inventing membership', async () => {
        mocks.session.mockResolvedValue(null);
        const stopped = new Error('redirected');
        mocks.redirect.mockImplementation(() => { throw stopped; });

        await expect(ListenerMembershipManagementPage()).rejects.toBe(stopped);
        expect(mocks.redirect).toHaveBeenCalledWith('/listener');
        expect(mocks.access).not.toHaveBeenCalled();
    });

    it('renders only the sanitized membership presentation for an authenticated account', async () => {
        const result = await ListenerMembershipManagementPage();

        expect(result.type).toBe(ListenerMembershipPage);
        expect(mocks.session).toHaveBeenCalledWith(expect.any(Headers));
        expect(mocks.access).toHaveBeenCalledWith('acct_stg_user');
        expect(mocks.membership).toHaveBeenCalledWith(access.membership.projection);
        expect(result.props).toMatchObject({
            membership: { kind: 'founder', provider: 'paypal', state: 'active' },
            quota: null,
            checkoutEnvironment: 'staging',
        });
        expect(JSON.stringify(result.props)).not.toContain('founder@example.test');
    });

    it('creates the private checkout token only on staging and only for the current account', async () => {
        mocks.workbench.mockReturnValue({
            accountId: 'acct_stg_user',
            provider: 'mercado_pago',
            csrfSecret: 's'.repeat(43),
        });
        mocks.createToken.mockReturnValue('bounded-csrf-token');
        mocks.checkout.mockReturnValue({ paypal: true, mercadoPago: false });
        mocks.membership.mockReturnValue({ kind: 'none', state: 'none' });

        const result = await ListenerMembershipManagementPage();

        expect(mocks.createToken).toHaveBeenCalledWith(expect.objectContaining({
            accountId: 'acct_stg_user',
            sessionId: 'session-1',
        }));
        expect(result.props.liveWorkbench).toEqual({
            provider: 'mercado_pago',
            csrfToken: 'bounded-csrf-token',
        });
        expect(result.props.checkoutAvailability).toEqual({ paypal: true, mercadoPago: false });
    });

    it('keeps both approved Live providers available to an eligible production account', async () => {
        mocks.headers.mockResolvedValue(new Headers({ host: 'listen.harmonicbeacon.com' }));
        mocks.checkout.mockReturnValue({ paypal: true, mercadoPago: true });
        mocks.membership.mockReturnValue({ kind: 'none', state: 'none' });

        const result = await ListenerMembershipManagementPage();

        expect(mocks.checkout).toHaveBeenCalledWith(process.env, 'live');
        expect(result.props).toMatchObject({
            membership: { kind: 'none', state: 'none' },
            checkoutEnvironment: 'live',
            checkoutAvailability: { paypal: true, mercadoPago: true },
            liveWorkbench: null,
        });
    });

    it('fails closed when the authoritative access lookup is unavailable', async () => {
        mocks.access.mockRejectedValue(new Error('database unavailable'));

        const result = await ListenerMembershipManagementPage();

        expect(result.type).toBe(ListenerMembershipPage);
        expect(result.props.serviceUnavailable).toBe(true);
        expect(result.props.checkoutAvailability).toEqual({ paypal: false, mercadoPago: false });
        expect(mocks.checkout).not.toHaveBeenCalled();
        expect(mocks.membership).not.toHaveBeenCalled();
    });
});
