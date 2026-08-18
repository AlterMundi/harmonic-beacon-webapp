import { describe, expect, it, vi } from 'vitest';

import { ACCOUNT_CREDENTIAL_FLOOR_MS, enforceAccountCredentialFloor } from '../timing';

describe('Account credential response timing contract', () => {
    it('pads every fast outcome to the same floor plus bounded jitter', async () => {
        const sleep = vi.fn(async () => undefined);
        await enforceAccountCredentialFloor(1_000, {
            now: () => 1_125,
            jitter: () => 17,
            sleep,
        });
        expect(sleep).toHaveBeenCalledWith(ACCOUNT_CREDENTIAL_FLOOR_MS + 17 - 125);
    });

    it('does not sleep after a slower scrypt/handler path has crossed the floor', async () => {
        const sleep = vi.fn(async () => undefined);
        await enforceAccountCredentialFloor(1_000, {
            now: () => 1_600,
            jitter: () => 40,
            sleep,
        });
        expect(sleep).not.toHaveBeenCalled();
    });
});
