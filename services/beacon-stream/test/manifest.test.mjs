import assert from 'node:assert/strict';
import test from 'node:test';
import { renderManifest } from '../src/manifest.mjs';
import { verifySignedPath } from '../src/auth.mjs';
import { metadata, variableMetadata } from './helpers.mjs';

const secret = 's'.repeat(32);

test('builds a deterministic wall-clock manifest and signs each segment URI', () => {
  const item = metadata();
  const epoch = item.epochMs;
  const manifest = renderManifest({ metadata: item, origin: 'https://stream.example.test', secret, nowMs: epoch + 42_000 });
  assert.match(manifest, /#EXT-X-MEDIA-SEQUENCE:2/);
  assert.match(manifest, /#EXT-X-DISCONTINUITY/);
  assert.match(manifest, /#EXT-X-PROGRAM-DATE-TIME:2026-08-06T00:00:36.000Z/);
  const urls = manifest.split('\n').filter((line) => line.startsWith('https://'));
  assert.equal(urls.length, 6);
  for (const stringUrl of urls) {
    const url = new URL(stringUrl);
    assert.equal(verifySignedPath({ secret, pathname: url.pathname, expiresAt: Number(url.searchParams.get('exp')), signature: url.searchParams.get('sig'), now: Math.floor((epoch + 42_000) / 1000) }), true);
  }
});

test('renders a signed fMP4 map and preserves a short final segment across loops', () => {
  const item = variableMetadata();
  const epoch = item.epochMs;
  const manifest = renderManifest({ metadata: item, origin: 'https://stream.example.test', secret, nowMs: epoch + 50_000 });
  assert.match(manifest, /#EXT-X-MEDIA-SEQUENCE:4/);
  assert.match(manifest, /#EXT-X-MAP:URI="https:\/\/stream\.example\.test\/v1\/hls\/approved-v2\/segments\/init\.mp4/);
  assert.match(manifest, /#EXT-X-DISCONTINUITY/);
  assert.match(manifest, /#EXTINF:4\.000000,/);
  assert.match(manifest, /#EXT-X-PROGRAM-DATE-TIME:2026-08-06T00:00:48\.000Z/);
  const mapUrl = new URL(manifest.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1]);
  assert.equal(verifySignedPath({ secret, pathname: mapUrl.pathname, expiresAt: Number(mapUrl.searchParams.get('exp')), signature: mapUrl.searchParams.get('sig'), now: Math.floor((epoch + 50_000) / 1000) }), true);
});
