import assert from 'node:assert/strict';
import test from 'node:test';

import {
  verifyDormantListenerLiveState,
} from '../../../scripts/early-birds-preview/listener-live-dormant-check.mjs';

function responseFor(url, init, overrides = {}) {
  const path = new URL(url).pathname;
  if (init.method === 'POST') return new Response('', { status: overrides[path] ?? 404 });
  if (path.startsWith('/api/health')) {
    return Response.json({ status: 'ok' }, { status: overrides[path] ?? 200 });
  }
  return new Response('<!doctype html><title>Listener</title>', {
    status: overrides[path] ?? 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

test('passes only with healthy fixed hosts, legal pages and every Live checkout path closed', async () => {
  const calls = [];
  const result = await verifyDormantListenerLiveState({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responseFor(url, init);
    },
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.checks.length, 14);
  assert.ok(result.checks.every((check) => check.passed));
  const posts = calls.filter((call) => call.init.method === 'POST');
  assert.equal(posts.length, 6);
  for (const { url, init } of posts) {
    const origin = new URL(url).origin;
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.origin, origin);
    assert.equal(init.headers['sec-fetch-site'], 'same-origin');
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers.cookie, undefined);
    assert.doesNotMatch(init.body, /email|token|subscription|account/i);
  }
});

test('fails closed if either productive provider becomes reachable', async () => {
  let checkoutCount = 0;
  const result = await verifyDormantListenerLiveState({
    fetchImpl: async (url, init) => {
      if (init.method === 'POST' && new URL(url).hostname === 'listen.harmonicbeacon.com' &&
          new URL(url).pathname === '/api/listener/checkout') {
        checkoutCount += 1;
        return new Response('', { status: checkoutCount === 2 ? 401 : 404 });
      }
      return responseFor(url, init);
    },
  });

  assert.equal(result.status, 'FAIL');
  assert.deepEqual(
    result.checks.find((check) => check.name === 'listener-mercado-pago-live-checkout-off'),
    { name: 'listener-mercado-pago-live-checkout-off', passed: false, status: 401 },
  );
});

test('fails closed on redirects, malformed health, oversized bodies and network errors', async () => {
  const result = await verifyDormantListenerLiveState({
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/api/health') return new Response('not-json', { headers: { 'content-type': 'application/json' } });
      if (path === '/api/health/ready' && new URL(url).hostname === 'earlybirds-staging.harmonicbeacon.com') {
        return new Response('', { status: 302, headers: { location: 'https://example.invalid/' } });
      }
      if (path === '/listener/privacy') {
        return new Response('x', { headers: { 'content-type': 'text/html', 'content-length': '70000' } });
      }
      if (path === '/listener/withdrawal') throw new Error('network details must not escape');
      return responseFor(url, init);
    },
  });

  assert.equal(result.status, 'FAIL');
  assert.deepEqual(Object.keys(result).sort(), ['checks', 'schemaVersion', 'status']);
  assert.doesNotMatch(JSON.stringify(result), /network details|example\.invalid|not-json/);
  assert.equal(result.checks.filter((check) => !check.passed).length, 4);
});
