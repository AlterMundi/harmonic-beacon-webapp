import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ count: vi.fn(), sign: vi.fn(), issuer: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { beaconJwks: { count: mocks.count } } }));
vi.mock('../auth', () => ({ accountAuth: () => ({ api: { signJWT: mocks.sign } }) }));
vi.mock('../authority-db', () => ({ accountAuthorityDatabaseReady: mocks.issuer }));
import { accountSigningKeyReady } from '../signing-key';

describe('Account signing-key readiness', () => {
    beforeEach(() => { vi.resetAllMocks(); mocks.issuer.mockResolvedValue(true); });
    it('preserves a live key without issuing a token', async () => {
        mocks.count.mockResolvedValue(1);
        expect(await accountSigningKeyReady()).toBe(true);
        expect(mocks.sign).not.toHaveBeenCalled();
    });
    it('coalesces expired-key recovery and verifies the replacement', async () => {
        let live = false;
        mocks.count.mockImplementation(async () => live ? 1 : 0);
        mocks.sign.mockImplementation(async () => { await new Promise(r => setTimeout(r, 5)); live = true; });
        expect(await Promise.all([accountSigningKeyReady(), accountSigningKeyReady()])).toEqual([true, true]);
        expect(mocks.sign).toHaveBeenCalledTimes(1);
        expect(mocks.sign.mock.calls[0][0].body.payload).toEqual({
            aud: 'urn:harmonic-beacon:signing-key-maintenance', exp: expect.any(Number),
        });
    });
    it('fails closed if signing fails or does not create a usable key', async () => {
        mocks.count.mockResolvedValue(0);
        mocks.sign.mockRejectedValueOnce(new Error('custody unavailable'));
        expect(await accountSigningKeyReady()).toBe(false);
        mocks.sign.mockResolvedValueOnce({});
        expect(await accountSigningKeyReady()).toBe(false);
    });
    it('does not issue keys into a mismatched authority database', async () => {
        mocks.issuer.mockResolvedValue(false);
        expect(await accountSigningKeyReady()).toBe(false);
        expect(mocks.sign).not.toHaveBeenCalled();
        expect(mocks.count).not.toHaveBeenCalled();
    });
});
