import { afterEach, describe, expect, it, vi } from 'vitest';
import { stackTest } from '../../../e2e/fixtures/stack';

// Inspect the real auto-fixture without starting a second test runner.
vi.mock('@playwright/test', () => ({
    expect: vi.fn(),
    test: { extend: (fixtures: unknown) => fixtures },
}));

type Fixture = (
    inputs: { request: { get: () => Promise<{ ok: () => boolean }> } },
    use: () => Promise<void>,
    testInfo: { skip: (condition: boolean, reason: string) => void },
) => Promise<void>;
const fixture = (stackTest as unknown as { stack: [Fixture] }).stack[0];

function skipWhenUnavailable(condition: boolean): void {
    if (condition) throw new Error('Local fixture skip');
}

afterEach(() => vi.unstubAllEnvs());

describe('required E2E fixture integrity', () => {
    it('fails CI instead of silently skipping when PostgreSQL readiness is unavailable', async () => {
        vi.stubEnv('CI', 'true');
        const use = vi.fn(async () => undefined);
        const skip = vi.fn(skipWhenUnavailable);
        const request = { get: async () => ({ ok: () => false }) };

        await expect(fixture({ request }, use, { skip })).rejects.toThrow(
            'CI requires a healthy E2E fixture stack',
        );
        expect(skip).not.toHaveBeenCalled();
        expect(use).not.toHaveBeenCalled();
    });

    it('fails CI when the fixture probe cannot connect', async () => {
        vi.stubEnv('CI', 'true');
        const use = vi.fn(async () => undefined);
        const skip = vi.fn(skipWhenUnavailable);
        const request = { get: async () => { throw new Error('connection refused'); } };

        await expect(fixture({ request }, use, { skip })).rejects.toThrow(
            'CI requires a healthy E2E fixture stack',
        );
        expect(skip).not.toHaveBeenCalled();
        expect(use).not.toHaveBeenCalled();
    });

    it('retains explicit local skips for developers without the optional stack', async () => {
        vi.stubEnv('CI', '');
        const use = vi.fn(async () => undefined);
        const skip = vi.fn(skipWhenUnavailable);
        const request = { get: async () => ({ ok: () => false }) };

        await expect(fixture({ request }, use, { skip })).rejects.toThrow('Local fixture skip');
        expect(skip).toHaveBeenCalledWith(true, expect.stringContaining('database unreachable'));
        expect(use).not.toHaveBeenCalled();
    });

    it.each(['', 'true'])('runs the real test with a healthy stack (CI=%s)', async (ci) => {
        vi.stubEnv('CI', ci);
        const use = vi.fn(async () => undefined);
        const skip = vi.fn(skipWhenUnavailable);
        const request = { get: async () => ({ ok: () => true }) };

        await fixture({ request }, use, { skip });
        expect(skip).toHaveBeenCalledWith(false, expect.any(String));
        expect(use).toHaveBeenCalledOnce();
    });
});
