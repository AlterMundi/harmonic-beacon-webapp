import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createPublicHandler, createInternalHandler, parseAllowedOrigins } from '../src/server.mjs';
import { signPath } from '../src/auth.mjs';
import { Metrics } from '../src/metrics.mjs';
import { metadata, temporaryArtifact } from './helpers.mjs';

const secret = 'z'.repeat(32);

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

test('only exposes minimal health publicly and protects manifest and every segment', async (t) => {
  const { artifactRoot } = await temporaryArtifact();
  const item = metadata();
  const metrics = new Metrics();
  const allowedOrigin = 'https://earlybirds-staging.example.test';
  const { server, origin } = await listen(createPublicHandler({
    artifactRoot,
    metadata: item,
    publicOrigin: 'https://stream.example.test',
    signingSecret: secret,
    allowedOrigins: new Set([allowedOrigin]),
    metrics,
  }));
  t.after(() => server.close());
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  assert.equal((await fetch(`${origin}/metrics`)).status, 404);
  assert.equal((await fetch(`${origin}/v1/hls/approved-v1/live.m3u8`)).status, 403);
  const pathname = '/v1/hls/approved-v1/live.m3u8';
  const expiry = Math.floor(Date.now() / 1000) + 60;
  const signature = signPath({ secret, pathname, expiresAt: expiry });
  const response = await fetch(`${origin}${pathname}?exp=${expiry}&sig=${signature}`, {
    headers: { Origin: allowedOrigin },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal(response.headers.get('vary'), 'Origin');
  const head = await fetch(`${origin}${pathname}?exp=${expiry}&sig=${signature}`, {
    method: 'HEAD',
    headers: { Origin: allowedOrigin },
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('access-control-allow-origin'), allowedOrigin);
  const manifest = await response.text();
  const segmentUrl = manifest.split('\n').find((line) => line.startsWith('https://'));
  assert.ok(segmentUrl);
  const productionUrl = new URL(segmentUrl);
  const localUrl = new URL(`${origin}${productionUrl.pathname}${productionUrl.search}`);
  const segment = await fetch(localUrl, { headers: { Origin: allowedOrigin } });
  assert.equal(segment.status, 200);
  assert.equal(segment.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.ok(['one', 'two', 'three'].includes(await segment.text()));

  const disallowed = await fetch(localUrl, {
    headers: { Origin: 'https://untrusted.example.test' },
  });
  assert.equal(disallowed.status, 200);
  assert.equal(disallowed.headers.get('access-control-allow-origin'), null);
});

test('accepts only explicit canonical HTTP origins for browser media fetches', () => {
  assert.deepEqual(
    [...parseAllowedOrigins('https://earlybirds.example.test, http://localhost:3000')],
    ['https://earlybirds.example.test', 'http://localhost:3000'],
  );
  assert.throws(() => parseAllowedOrigins(''), /at least one origin/);
  assert.throws(() => parseAllowedOrigins('https://user@example.test'), /invalid origin/);
  assert.throws(() => parseAllowedOrigins('https://example.test/path'), /invalid origin/);
});

test('publishes readiness and Prometheus metrics only on the internal listener', async (t) => {
  const metrics = new Metrics();
  const { server, origin } = await listen(createInternalHandler({ metadata: metadata(), metrics }));
  t.after(() => server.close());
  assert.equal((await fetch(`${origin}/readyz`)).status, 200);
  const body = await (await fetch(`${origin}/metrics`)).text();
  assert.match(body, /beacon_stream_http_requests_total/);
});
