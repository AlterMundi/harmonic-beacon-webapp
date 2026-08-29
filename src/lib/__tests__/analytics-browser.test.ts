import { describe, expect, it } from 'vitest';

import { analyticsBrowserConfig } from '@/lib/analytics-browser';

describe('Account and Listener browser analytics boundary', () => {
    it.each([
        ['account.harmonicbeacon.com', 'account', 'production'],
        ['account-staging.harmonicbeacon.com:443', 'account', 'staging'],
        ['listen.harmonicbeacon.com', 'listen', 'production'],
        ['earlybirds-staging.harmonicbeacon.com', 'listen', 'staging'],
    ])('classifies the exact host %s', (host, surface, environment) => {
        expect(analyticsBrowserConfig(new Headers({ host }))).toEqual({
            collector: 'https://live.harmonicbeacon.com/_a', surface, environment,
        });
    });

    it.each(['localhost:3000', 'account.harmonicbeacon.com.evil.test', ''])('does not instrument non-public host %s', host => {
        expect(analyticsBrowserConfig(new Headers(host ? { host } : {}))).toBeNull();
    });
});
