import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

const URL = 'https://app.example.test/api/early-birds/test-login';

function request(authorization?: string): NextRequest {
    return new NextRequest(URL, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({
            email: 'listener@e2e.invalid',
            name: 'Synthetic Listener',
        }),
    });
}

describe('EarlyBird synthetic login seam', () => {
    beforeEach(() => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_TEST_ACCESS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_TEST_LOGIN_SECRET', 's'.repeat(32));
    });
    afterEach(() => vi.unstubAllEnvs());

    it('hides the route when the caller omits the test-only bearer', async () => {
        const response = await POST(request());
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'Not found.' });
    });

    it('hides the route for a wrong or malformed bearer', async () => {
        await expect(POST(request(`Bearer ${'x'.repeat(32)}`))).resolves.toMatchObject({ status: 404 });
        await expect(POST(request(`Basic ${'s'.repeat(32)}`))).resolves.toMatchObject({ status: 404 });
    });

    it('stays disabled with a short configured secret', async () => {
        vi.stubEnv('EARLY_BIRDS_TEST_LOGIN_SECRET', 'short');
        await expect(POST(request('Bearer short'))).resolves.toMatchObject({ status: 404 });
    });
});
