import { describe, expect, it } from 'vitest';

import { GET as getRobots } from '../robots.txt/route';
import { GET as getSitemap } from '../sitemap.xml/route';

function request(path: string, host: string): Request {
    return new Request(`https://${host}${path}`, { headers: { host } });
}

describe('Listener discovery routes', () => {
    it('serves robots and sitemap on the canonical public host', async () => {
        const robots = getRobots(request('/robots.txt', 'listen.harmonicbeacon.com'));
        const sitemap = getSitemap(request('/sitemap.xml', 'listen.harmonicbeacon.com'));

        expect(robots.status).toBe(200);
        expect(robots.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(await robots.text()).toContain('https://listen.harmonicbeacon.com/sitemap.xml');
        expect(sitemap.status).toBe(200);
        expect(sitemap.headers.get('content-type')).toBe('application/xml; charset=utf-8');
        expect(await sitemap.text()).toContain('<loc>https://listen.harmonicbeacon.com/</loc>');
    });

    it.each(['live.harmonicbeacon.com', 'earlybirds-staging.harmonicbeacon.com']) (
        'fails closed on %s',
        async (host) => {
            const robots = getRobots(request('/robots.txt', host));
            const sitemap = getSitemap(request('/sitemap.xml', host));

            expect(robots.status).toBe(404);
            expect(sitemap.status).toBe(404);
            expect(await robots.text()).toBe('');
            expect(await sitemap.text()).toBe('');
        },
    );
});
