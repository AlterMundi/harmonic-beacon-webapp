import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { mintManifestUrl, parseManifest } from '../canary/canary-exporter.mjs';

test('extracts a signed segment and measures the newest manifest edge age', () => {
  const result = parseManifest([
    '#EXTM3U',
    '#EXT-X-PROGRAM-DATE-TIME:2026-08-06T00:00:12.000Z',
    '#EXTINF:6.000,',
    'https://stream.example.test/v1/hls/a/segments/00002.m4s?exp=1&sig=opaque',
    '',
  ].join('\n'), Date.parse('2026-08-06T00:00:18.000Z'));
  assert.equal(result.segmentUrl.startsWith('https://stream.example.test/'), true);
  assert.equal(result.manifestAgeSeconds, 6);
});

test('does not accept a response that only happens to be HTTP text', () => {
  assert.throws(() => parseManifest('not a manifest\n'), /not an HLS manifest/);
});

test('mints a fresh manifest URL using the exact origin HMAC canonical contract', () => {
  const secret = 'x'.repeat(32);
  const nowMs = Date.parse('2026-08-06T00:00:00.000Z');
  const url = new URL(mintManifestUrl({ origin: 'https://stream.example.test', id: 'approved-v1', secret, nowMs }));
  const expiresAt = Number(url.searchParams.get('exp'));
  assert.equal(expiresAt, Math.floor(nowMs / 1000) + 120);
  const expected = crypto.createHmac('sha256', secret)
    .update(`GET\n/v1/hls/approved-v1/live.m3u8\n${expiresAt}`).digest('base64url');
  assert.equal(url.searchParams.get('sig'), expected);
  assert.throws(() => mintManifestUrl({ origin: 'https://stream.example.test', id: 'approved-v1', secret, nowMs, ttlSeconds: 121 }), /token TTL/);
});
