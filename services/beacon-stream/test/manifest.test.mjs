import assert from 'node:assert/strict';
import test from 'node:test';
import { renderManifest } from '../src/manifest.mjs';
import { verifySignedPath } from '../src/auth.mjs';
import { metadata } from './helpers.mjs';

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
