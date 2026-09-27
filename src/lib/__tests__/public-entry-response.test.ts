import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { publicEntryFailure } from '../public-entry-response';

describe('public entry failures', () => {
    it('gives browser navigation a readable explanation and safe recovery without caching identity', async () => {
        const request = new NextRequest('https://live.example/api/public-sessions/id/enter', {
            headers: { accept: 'text/html', cookie: 'hb_locale=en' },
        });
        const response = publicEntryFailure(request, 'entry_not_attached', 409);
        expect(response.status).toBe(409);
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        const html = await response.text();
        expect(html).toContain('Sign in again');
        expect(html).toContain('/api/account/login?flow=attendee');
        expect(html).not.toContain('<script');
    });
    it('preserves machine-readable reason and next action for API clients', async () => {
        const response = publicEntryFailure(new NextRequest('https://live.example'), 'event_unavailable', 404);
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: 'event_unavailable', action: { href: '/' } });
    });
});
