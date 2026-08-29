import { describe, expect, it } from 'vitest';

import { analyticsBrowserConfig } from '@/lib/analytics-browser';

describe('Live browser analytics boundary', () => {
    it.each([
        ['live.harmonicbeacon.com', 'production'],
        ['live-staging.harmonicbeacon.com:443', 'staging'],
    ])('classifies the exact host %s', (host, environment) => {
        expect(analyticsBrowserConfig(new Headers({ host }))).toEqual({
            collector: 'https://live.harmonicbeacon.com/_a', surface: 'live', environment,
        });
    });

    it.each(['localhost:3000', 'live.harmonicbeacon.com.evil.test', ''])('does not instrument non-public host %s', host => {
        expect(analyticsBrowserConfig(new Headers(host ? { host } : {}))).toBeNull();
    });
});
