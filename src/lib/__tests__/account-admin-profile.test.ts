import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/account-rp', () => ({ accountConfiguration: () => ({
    issuer: 'https://account.example.test', clientId: 'hb-live', clientSecret: 'synthetic-secret',
}) }));
import { fetchAccountAdminProfile } from '../account-admin-profile';
afterEach(() => vi.unstubAllGlobals());

describe('private Account backchannel', () => {
    it('never sends credentials to a foreign issuer', async () => {
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        expect(await fetchAccountAdminProfile('https://other.example.test', 'subject')).toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('binds the exact subject and refuses redirect following', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
            sub: 'subject', preferredName: 'Alias', realName: 'Private', email: null, emailVerified: false,
        }) });
        vi.stubGlobal('fetch', fetcher);
        expect(await fetchAccountAdminProfile('https://account.example.test', 'subject')).toMatchObject({ realName: 'Private', email: null });
        expect(fetcher).toHaveBeenCalledWith(new URL('https://account.example.test/api/account/admin-profile'), expect.objectContaining({
            method: 'POST', body: JSON.stringify({ sub: 'subject' }), cache: 'no-store', redirect: 'error',
        }));
    });
    it('rejects another subject instead of displaying someone else’s profile', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sub: 'other', realName: 'Other private' }) }));
        await expect(fetchAccountAdminProfile('https://account.example.test', 'subject')).rejects.toThrow('subject mismatch');
    });
    it('does not forward unrecognized fields from the private response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sub: 'subject', token: 'never-forward', realName: 'x'.repeat(121) }) }));
        expect(await fetchAccountAdminProfile('https://account.example.test', 'subject')).toEqual({ preferredName: null, realName: null, email: null, emailVerified: null });
    });
});
