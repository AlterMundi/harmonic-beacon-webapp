#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const ATTEMPT_ID = '00000000-0000-4000-8000-000000000000';

const hosts = Object.freeze({
  listener: 'https://listen.harmonicbeacon.com',
  staging: 'https://earlybirds-staging.harmonicbeacon.com',
  event: 'https://live.harmonicbeacon.com',
});

const checks = Object.freeze([
  { name: 'listener-health', kind: 'health', url: `${hosts.listener}/api/health` },
  { name: 'listener-readiness', kind: 'health', url: `${hosts.listener}/api/health/ready` },
  { name: 'staging-readiness', kind: 'health', url: `${hosts.staging}/api/health/ready` },
  { name: 'event-readiness', kind: 'health', url: `${hosts.event}/api/health/ready` },
  { name: 'listener-terms', kind: 'html', url: `${hosts.listener}/listener/terms` },
  { name: 'listener-privacy', kind: 'html', url: `${hosts.listener}/listener/privacy` },
  { name: 'listener-withdrawal', kind: 'html', url: `${hosts.listener}/listener/withdrawal` },
  {
    name: 'listener-service-cancellation',
    kind: 'html',
    url: `${hosts.listener}/listener/cancel-service`,
  },
  {
    name: 'listener-paypal-live-checkout-off',
    kind: 'closed',
    url: `${hosts.listener}/api/listener/checkout`,
    origin: hosts.listener,
    body: { provider: 'paypal', attemptId: ATTEMPT_ID },
  },
  {
    name: 'listener-mercado-pago-live-checkout-off',
    kind: 'closed',
    url: `${hosts.listener}/api/listener/checkout`,
    origin: hosts.listener,
    body: { provider: 'mercado_pago', attemptId: ATTEMPT_ID },
  },
  {
    name: 'listener-live-workbench-absent',
    kind: 'closed',
    url: `${hosts.listener}/api/listener/checkout/live-workbench`,
    origin: hosts.listener,
    body: { attemptId: ATTEMPT_ID },
  },
  {
    name: 'staging-live-workbench-off',
    kind: 'closed',
    url: `${hosts.staging}/api/listener/checkout/live-workbench`,
    origin: hosts.staging,
    body: { attemptId: ATTEMPT_ID },
  },
  {
    name: 'event-checkout-absent',
    kind: 'closed',
    url: `${hosts.event}/api/listener/checkout`,
    origin: hosts.event,
    body: { provider: 'paypal', attemptId: ATTEMPT_ID },
  },
  {
    name: 'event-live-workbench-absent',
    kind: 'closed',
    url: `${hosts.event}/api/listener/checkout/live-workbench`,
    origin: hosts.event,
    body: { attemptId: ATTEMPT_ID },
  },
]);

async function boundedBody(response) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('invalid_response');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('invalid_response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

async function runCheck(check, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const isPost = check.kind === 'closed';
    const response = await fetchImpl(check.url, {
      method: isPost ? 'POST' : 'GET',
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
      headers: isPost ? {
        accept: 'application/json',
        'content-type': 'application/json',
        origin: check.origin,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      } : { accept: check.kind === 'html' ? 'text/html' : 'application/json' },
      body: isPost ? JSON.stringify(check.body) : undefined,
    });
    if (check.kind === 'closed') {
      await response.body?.cancel().catch(() => undefined);
      return { name: check.name, passed: response.status === 404, status: response.status };
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return { name: check.name, passed: false, status: response.status };
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    const body = await boundedBody(response);
    if (check.kind === 'html') {
      return { name: check.name, passed: contentType === 'text/html' && body.length > 0, status: 200 };
    }
    let value;
    try {
      value = JSON.parse(body);
    } catch {
      value = null;
    }
    return {
      name: check.name,
      passed: contentType === 'application/json' && value?.status === 'ok',
      status: 200,
    };
  } catch {
    return { name: check.name, passed: false, status: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyDormantListenerLiveState({ fetchImpl = fetch } = {}) {
  const results = await Promise.all(checks.map((check) => runCheck(check, fetchImpl)));
  return {
    schemaVersion: 'listener-live-dormant-check.v1',
    status: results.every((result) => result.passed) ? 'PASS' : 'FAIL',
    checks: results,
  };
}

async function main() {
  if (process.argv.length !== 2) {
    process.stderr.write('Usage: node scripts/early-birds-preview/listener-live-dormant-check.mjs\n');
    process.exitCode = 2;
    return;
  }
  const result = await verifyDormantListenerLiveState();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
