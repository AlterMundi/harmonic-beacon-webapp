import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createPublicHandler, createInternalHandler } from '../src/server.mjs';
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
  const { server, origin } = await listen(createPublicHandler({ artifactRoot, metadata: item, publicOrigin: 'https://stream.example.test', signingSecret: secret, metrics }));
  t.after(() => server.close());
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  assert.equal((await fetch(`${origin}/metrics`)).status, 404);
  assert.equal((await fetch(`${origin}/v1/hls/approved-v1/live.m3u8`)).status, 403);
  const pathname = '/v1/hls/approved-v1/live.m3u8';
  const expiry = Math.floor(Date.now() / 1000) + 60;
  const signature = signPath({ secret, pathname, expiresAt: expiry });
  const response = await fetch(`${origin}${pathname}?exp=${expiry}&sig=${signature}`);
  assert.equal(response.status, 200);
  const manifest = await response.text();
  const segmentUrl = manifest.split('\n').find((line) => line.startsWith('https://'));
  assert.ok(segmentUrl);
  const productionUrl = new URL(segmentUrl);
  const localUrl = new URL(`${origin}${productionUrl.pathname}${productionUrl.search}`);
  const segment = await fetch(localUrl);
  assert.equal(segment.status, 200);
  assert.ok(['one', 'two', 'three'].includes(await segment.text()));
});

test('publishes readiness and Prometheus metrics only on the internal listener', async (t) => {
  const metrics = new Metrics();
  const { server, origin } = await listen(createInternalHandler({ metadata: metadata(), metrics }));
  t.after(() => server.close());
  assert.equal((await fetch(`${origin}/readyz`)).status, 200);
  const body = await (await fetch(`${origin}/metrics`)).text();
  assert.match(body, /beacon_stream_http_requests_total/);
});
