import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitAnalyticsEvent } from '@/lib/analytics-server';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('canonical analytics emitter', () => {
    it('uses the explicit deployment environment instead of NODE_ENV', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('ANALYTICS_INTERNAL_URL', 'https://collector.example.test/_a');
        vi.stubEnv('ANALYTICS_SERVER_EVENT_SECRET', 's'.repeat(32));
        vi.stubEnv('ANALYTICS_IDENTITY_SECRET', 'i'.repeat(32));
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(emitAnalyticsEvent({
            eventName: 'identity.linked', source: 'account', surface: 'account',
            accountId: 'account-id', environment: 'staging',
        })).resolves.toBe(true);

        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(String(request.body))).toMatchObject({
            environment: 'staging', source: 'account', surface: 'account',
            account_subject: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        expect(request.headers).toMatchObject({
            'x-hb-event-signature': expect.stringMatching(/^[a-f0-9]{64}$/),
        });
    });

    it('fails open when the collector is unavailable', async () => {
        vi.stubEnv('ANALYTICS_INTERNAL_URL', 'https://collector.example.test/_a');
        vi.stubEnv('ANALYTICS_SERVER_EVENT_SECRET', 's'.repeat(32));
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        await expect(emitAnalyticsEvent({
            eventName: 'page.server_observed', source: 'account', surface: 'account',
        })).resolves.toBe(false);
    });
});
