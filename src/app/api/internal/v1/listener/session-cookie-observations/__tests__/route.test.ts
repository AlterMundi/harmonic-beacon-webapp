import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('@/lib/listener/session-cookie-observability', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/listener/session-cookie-observability')>();
    mocks.render.mockImplementation(original.renderListenerSessionCookieObservations);
    return {
        ...original,
        renderListenerSessionCookieObservations: mocks.render,
    };
});

import { GET } from '../route';
import {
    LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC,
    LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC,
    LISTENER_SESSION_COOKIE_STATES,
    recordListenerSessionCookieObservation,
} from '@/lib/listener/session-cookie-observability';

const PATH = '/api/internal/v1/listener/session-cookie-observations';

function request(host: string | null, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(`http://beacon-app:3000${PATH}`, {
        headers: { ...(host === null ? {} : { host }), ...headers },
    });
}

describe('Listener session-cookie observations route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('serves the fixed Prometheus exposition on the canonical Listener host', async () => {
        recordListenerSessionCookieObservation('dual_identical');
        const response = GET(request('listen.harmonicbeacon.com'));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/plain; version=0.0.4; charset=utf-8');
        expect(response.headers.get('cache-control')).toBe('private, no-store');

        const body = await response.text();
        for (const state of LISTENER_SESSION_COOKIE_STATES) {
            expect(body).toContain(`${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC}{state="${state}"}`);
        }
        const labelSets = [...body.matchAll(/\{([^}]*)\}/g)].map((match) => match[1]);
        expect(labelSets).toHaveLength(LISTENER_SESSION_COOKIE_STATES.length);
        for (const labelSet of labelSets) expect(labelSet).toMatch(/^state="[a-z_]+"$/);
        expect(body).toMatch(new RegExp(`^${LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC} \\d+$`, 'm'));
    });

    it('accepts the canonical host with an optional port', async () => {
        const response = GET(request('listen.harmonicbeacon.com:443'));
        expect(response.status).toBe(200);
    });

    it('answers 404 on any other host and never trusts a forwarded host', async () => {
        for (const host of [
            'live.harmonicbeacon.com',
            'earlybirds-staging.harmonicbeacon.com',
            'beacon-app:3000',
            'listen.harmonicbeacon.com.attacker.invalid',
        ]) {
            const response = GET(request(host));
            expect(response.status, host).toBe(404);
            expect(response.headers.get('cache-control')).toBe('private, no-store');
            await expect(response.json()).resolves.toEqual({ error: 'Resource not found.' });
        }
        // A forwarded header never substitutes for the request Host.
        const spoofed = GET(request('live.harmonicbeacon.com', {
            'x-forwarded-host': 'listen.harmonicbeacon.com',
        }));
        expect(spoofed.status).toBe(404);
        const missing = GET(request(null, { 'x-forwarded-host': 'listen.harmonicbeacon.com' }));
        expect(missing.status).toBe(404);
    });

    it('answers a generic 503 when its own observer fails', async () => {
        mocks.render.mockImplementationOnce(() => {
            throw new Error('observer down');
        });
        const response = GET(request('listen.harmonicbeacon.com'));
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        const body = await response.text();
        expect(body).not.toContain('observer down');
        expect(JSON.parse(body)).toEqual({ error: 'Session-cookie observations unavailable.' });
    });

    it('is GET-only and touches no database, auth or request metadata', async () => {
        const routeModule = await import('../route');
        expect('POST' in routeModule).toBe(false);
        // No authorization, cookie, body or query material is read: the Host
        // header alone decides, and the exposition is fixed aggregate state.
        const source = await import('node:fs/promises')
            .then((fs) => fs.readFile(new URL('../route.ts', import.meta.url), 'utf8'));
        expect(source).not.toMatch(/@\/lib\/db|prisma|service-auth|authorization|cookies\(\)/);
    });
});
