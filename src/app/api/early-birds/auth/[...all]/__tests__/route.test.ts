import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handler = vi.hoisted(() => vi.fn());
vi.mock('@/lib/early-birds/auth', () => ({ earlyBirdAuth: () => ({ handler }) }));

import { POST } from '../route';

describe('EarlyBird public auth route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
    });
    afterEach(() => vi.unstubAllEnvs());

    it.each(['sign-up', 'sign-in'])('does not publicly expose synthetic email %s', async (operation) => {
        const request = new NextRequest(
            `https://earlybirds-staging.example.test/api/early-birds/auth/${operation}/email`,
            { method: 'POST', body: '{}' },
        );
        const response = await POST(request);
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(handler).not.toHaveBeenCalled();
    });
});
