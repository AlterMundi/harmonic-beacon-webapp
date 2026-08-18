import { describe, expect, it } from 'vitest';

import { GET, POST } from '../route';

describe('removed Listener-local identity authority', () => {
    it.each([GET, POST])('fails every legacy provider and magic-link path closed', async (handler) => {
        const response = await handler(new Request(
            'https://listen.harmonicbeacon.com/api/early-birds/auth/sign-in/social',
            { method: handler === POST ? 'POST' : 'GET' },
        ));
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toEqual({ error: 'not_found' });
    });
});
