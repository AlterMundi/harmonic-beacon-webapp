import { describe, expect, it } from 'vitest';

import {
    createListenerLiveWorkbenchCsrfToken,
    listenerLiveWorkbenchConfig,
    validateListenerLiveWorkbenchEnvironment,
    verifyListenerLiveWorkbenchCsrfToken,
} from '../live-workbench';

const environment = {
    BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED: '1',
    BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID: 'opaque-account_1',
    BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER: 'paypal',
    BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET: 's'.repeat(43),
    BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED: '0',
    BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED: '0',
};

describe('private Listener Live workbench configuration', () => {
    it('is default-off and requires one exact account, provider and secret', () => {
        expect(listenerLiveWorkbenchConfig({})).toBeNull();
        expect(listenerLiveWorkbenchConfig({ ...environment, BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED: 'true' })).toBeNull();
        expect(listenerLiveWorkbenchConfig({ ...environment, BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID: 'a,b' })).toBeNull();
        expect(listenerLiveWorkbenchConfig({ ...environment, BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER: 'all' })).toBeNull();
        expect(listenerLiveWorkbenchConfig({ ...environment, BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET: 'short' })).toBeNull();
        expect(listenerLiveWorkbenchConfig(environment)).toEqual({
            accountId: 'opaque-account_1',
            provider: 'paypal',
            csrfSecret: 's'.repeat(43),
        });
    });

    it('cannot coexist with either public Listener Live provider', () => {
        expect(listenerLiveWorkbenchConfig({
            ...environment,
            BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED: '1',
        })).toBeNull();
        expect(listenerLiveWorkbenchConfig({
            ...environment,
            BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED: '1',
        })).toBeNull();
    });

    it('makes partial or ambiguous enabled configuration fail readiness', () => {
        expect(validateListenerLiveWorkbenchEnvironment({})).toBe(false);
        expect(validateListenerLiveWorkbenchEnvironment({
            BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED: '0',
        })).toBe(false);
        expect(() => validateListenerLiveWorkbenchEnvironment({
            BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED: 'true',
        })).toThrow(/exactly 0 or 1/);
        expect(() => validateListenerLiveWorkbenchEnvironment({
            BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED: '1',
        })).toThrow(/requires one valid account/);
        expect(validateListenerLiveWorkbenchEnvironment(environment)).toBe(true);
    });

    it('binds short-lived CSRF proof to account, session and server-selected provider', () => {
        const config = listenerLiveWorkbenchConfig(environment)!;
        const now = new Date('2026-08-13T12:00:00.000Z');
        const token = createListenerLiveWorkbenchCsrfToken({
            config,
            accountId: config.accountId,
            sessionId: 'session-1',
            now,
        });
        expect(token).not.toBeNull();
        expect(verifyListenerLiveWorkbenchCsrfToken({
            config,
            token,
            accountId: config.accountId,
            sessionId: 'session-1',
            now: new Date('2026-08-13T12:14:59.000Z'),
        })).toBe(true);
        expect(verifyListenerLiveWorkbenchCsrfToken({
            config,
            token,
            accountId: config.accountId,
            sessionId: 'other-session',
            now,
        })).toBe(false);
        expect(verifyListenerLiveWorkbenchCsrfToken({
            config: { ...config, provider: 'mercado_pago' },
            token,
            accountId: config.accountId,
            sessionId: 'session-1',
            now,
        })).toBe(false);
        expect(verifyListenerLiveWorkbenchCsrfToken({
            config,
            token,
            accountId: config.accountId,
            sessionId: 'session-1',
            now: new Date('2026-08-13T12:15:01.000Z'),
        })).toBe(false);
    });

    it('does not mint a token for a non-allowlisted account', () => {
        const config = listenerLiveWorkbenchConfig(environment)!;
        expect(createListenerLiveWorkbenchCsrfToken({
            config,
            accountId: 'another-account',
            sessionId: 'session-1',
        })).toBeNull();
    });
});
