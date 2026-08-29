import assert from 'node:assert/strict';
import test from 'node:test';

import { browserOriginContext, ContractError, sanitizePath, validateEvent } from '../src/contract.mjs';

const browserEvent = (overrides = {}) => ({
    schema_version: 'hb.analytics.event.v1',
    event_id: '10000000-0000-4000-8000-000000000001',
    event_name: 'page.viewed',
    occurred_at: '2026-08-29T04:00:00.000Z',
    source: 'browser', surface: 'home', environment: 'production',
    visitor_id: '10000000-0000-4000-8000-000000000002',
    session_id: '10000000-0000-4000-8000-000000000003',
    traffic_class: 'real',
    page: { path: '/welcome?token=secret#x', title: 'Welcome', referrer: 'https://search.example/q?private=yes', landing: '/' },
    attribution: { utm_source: 'newsletter', fbclid: 'opaque-click', referrer: 'https://example.test/path?secret=yes', landing: '/welcome?gclid=secret' },
    device: { class: 'mobile', browser: 'Safari', os: 'iOS', language: 'es-AR', screen: '390x844' },
    properties: { component: 'hero' },
    ...overrides,
});

test('validates a strict browser event and strips queries', () => {
    const value = validateEvent(browserEvent());
    assert.equal(value.page.path, '/welcome');
    assert.equal(value.page.referrer, 'https://search.example/q');
    assert.equal(value.attribution.fbclid, 'opaque-click');
    assert.equal(value.attribution.referrer, 'https://example.test/path');
    assert.equal(value.attribution.landing, '/welcome');
});

test('rejects unknown fields and sensitive property names', () => {
    assert.throws(() => validateEvent(browserEvent({ surprise: true })), ContractError);
    assert.throws(() => validateEvent(browserEvent({ properties: { password: 'hello' } })), /prohibited/);
    assert.throws(() => validateEvent(browserEvent({ properties: { access_token: 'hello' } })), /prohibited/);
    assert.throws(() => validateEvent(browserEvent({ properties: { email: 'person@example.test' } })), /prohibited/);
});

test('browser cannot declare canonical or account facts', () => {
    assert.throws(() => validateEvent(browserEvent({ event_name: 'payment.confirmed' })), /canonical/);
    assert.throws(() => validateEvent(browserEvent({ account_subject: 'a'.repeat(64) })), /account_subject/);
    assert.throws(() => validateEvent(browserEvent({ traffic_class: 'internal' })), /classify/);
});

test('server facts require authentication and valid opaque subject', () => {
    const server = browserEvent({
        source: 'account', surface: 'account', event_name: 'account.created',
        account_subject: 'a'.repeat(64), visitor_id: null, session_id: null,
        properties: { source_key_digest: 'b'.repeat(64), auth_method: 'google' },
    });
    assert.throws(() => validateEvent(server), /requires authentication/);
    assert.equal(validateEvent(server, { serverAuthenticated: true }).account_subject, 'a'.repeat(64));
});

test('path sanitizer never retains query or fragment', () => {
    assert.equal(sanitizePath('https://listen.harmonicbeacon.com/a?grant=secret#fragment'), 'https://listen.harmonicbeacon.com/a');
    assert.equal(sanitizePath('/a?grant=secret'), '/a');
});

test('browser origins canonically bind surface and environment', () => {
    assert.deepEqual(browserOriginContext('https://harmonicbeacon.com'), {
        surface: 'home', environment: 'production',
    });
    assert.deepEqual(browserOriginContext('https://live-staging.harmonicbeacon.com'), {
        surface: 'live', environment: 'staging',
    });
    assert.equal(browserOriginContext(null), null);
    assert.equal(browserOriginContext('https://harmonicbeacon.com.evil.test'), null);
});
