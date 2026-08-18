import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    session: vi.fn(),
    rate: vi.fn(),
    hash: vi.fn(),
}));

vi.mock('@/lib/account/auth', () => ({ currentAccountSession: mocks.session }));
vi.mock('@/lib/account/rate-limit', () => ({ consumeAccountRateLimit: mocks.rate }));
vi.mock('@/lib/account/config', () => ({
    accountEnvironment: () => 'https://account.harmonicbeacon.com',
    accountRateSecret: () => 'rate-secret-at-least-thirty-two-characters',
}));
vi.mock('@/lib/session-auth', () => ({
    hashAccountPassword: mocks.hash,
    verifyAccountPassword: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('@/lib/account/mail-outbox', () => ({
    queueAccountActionMail: vi.fn(), queueAccountActionMailInTransaction: vi.fn(),
}));
vi.mock('@/lib/account/action-tokens', () => ({
    accountActionTokenCanProceed: vi.fn(), consumeAccountActionTokenWith: vi.fn(),
}));
vi.mock('@/lib/account/revocation', () => ({ revokeAllAccountSessions: vi.fn() }));

import { changeAccountPassword } from '../credential-actions';

describe('Account credential action admission', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.session.mockResolvedValue({ user: { id: 'account-id' }, session: { id: 'session-id' } });
    });

    it('does not perform expensive password hashing after durable admission is blocked', async () => {
        mocks.rate.mockResolvedValue(false);
        const request = new Request('https://account.harmonicbeacon.com/api/account/password/change', {
            method: 'POST', headers: { origin: 'https://account.harmonicbeacon.com' },
        });
        await expect(changeAccountPassword(request, 'old password value', 'new password value')).resolves.toBe(false);
        expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({
            email: 'account-id', purpose: 'password-change', maxPerEmail: 5,
        }));
        expect(mocks.hash).not.toHaveBeenCalled();
    });
});
