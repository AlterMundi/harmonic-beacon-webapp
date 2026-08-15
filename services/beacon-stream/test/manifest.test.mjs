import assert from 'node:assert/strict';
import test from 'node:test';
import { renderManifest, WINDOW_SEGMENTS } from '../src/manifest.mjs';
import { verifySignedPath } from '../src/auth.mjs';
import { metadata, variableMetadata } from './helpers.mjs';

const secret = 's'.repeat(32);

test('builds a deterministic wall-clock manifest and signs each segment URI', () => {
  const item = metadata();
  const epoch = item.epochMs;
  const manifest = renderManifest({ metadata: item, origin: 'https://stream.example.test', secret, nowMs: epoch + 42_000 });
  assert.match(manifest, /#EXT-X-MEDIA-SEQUENCE:0/);
  assert.match(manifest, /#EXT-X-DISCONTINUITY/);
  assert.match(manifest, /#EXT-X-PROGRAM-DATE-TIME:2026-08-06T00:00:36.000Z/);
  const urls = manifest.split('\n').filter((line) => line.startsWith('https://'));
  assert.equal(urls.length, 8);
  for (const stringUrl of urls) {
    const url = new URL(stringUrl);
    assert.equal(verifySignedPath({ secret, pathname: url.pathname, expiresAt: Number(url.searchParams.get('exp')), signature: url.searchParams.get('sig'), now: Math.floor((epoch + 42_000) / 1000) }), true);
  }
});

test('retains a five-minute stability window once enough program time exists', () => {
  const item = metadata();
  const manifest = renderManifest({
    metadata: item,
    origin: 'https://stream.example.test',
    secret,
    nowMs: item.epochMs + 10 * 60_000,
  });
  const urls = manifest.split('\n').filter((line) => line.startsWith('https://'));
  assert.equal(WINDOW_SEGMENTS, 50);
  assert.equal(urls.length, WINDOW_SEGMENTS);
});

test('never signs a segment beyond the inbound manifest authorization horizon', () => {
  const item = metadata();
  const nowMs = item.epochMs + 42_000;
  const authorizationExpiresAtSeconds = Math.floor(nowMs / 1000) + 7;
  const manifest = renderManifest({
    metadata: item,
    origin: 'https://stream.example.test',
    secret,
    nowMs,
    tokenTtlSeconds: 120,
    authorizationExpiresAtSeconds,
  });

  const urls = manifest.split('\n').filter((line) => line.startsWith('https://'));
  assert.ok(urls.length > 0);
  for (const stringUrl of urls) {
    assert.equal(Number(new URL(stringUrl).searchParams.get('exp')), authorizationExpiresAtSeconds);
  }
});

test('carries one stable opaque media grant across every map and segment URL', () => {
  const item = variableMetadata();
  const grantId = 'a'.repeat(64);
  const grant = 'b'.repeat(43);
  const manifest = renderManifest({
    metadata: item,
    origin: 'https://stream.example.test',
    secret,
    nowMs: item.epochMs + 50_000,
    mediaAuthorizationQuery: { grantId, grant },
  });
  const urls = [
    ...manifest.split('\n').filter((line) => line.startsWith('https://')),
    manifest.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1],
  ].filter(Boolean);
  assert.ok(urls.length > 1);
  for (const value of urls) {
    const url = new URL(value);
    assert.equal(url.searchParams.get('grantId'), grantId);
    assert.equal(url.searchParams.get('grant'), grant);
    assert.equal(url.searchParams.has('exp'), false);
    assert.equal(url.searchParams.has('sig'), false);
  }
});

test('renders a signed fMP4 map and preserves a short final segment across loops', () => {
  const item = variableMetadata();
  const epoch = item.epochMs;
  const manifest = renderManifest({ metadata: item, origin: 'https://stream.example.test', secret, nowMs: epoch + 50_000 });
  assert.match(manifest, /#EXT-X-MEDIA-SEQUENCE:0/);
  assert.match(manifest, /#EXT-X-MAP:URI="https:\/\/stream\.example\.test\/v1\/hls\/approved-v2\/segments\/init\.mp4/);
  assert.match(manifest, /#EXT-X-DISCONTINUITY/);
  assert.match(manifest, /#EXTINF:4\.000000,/);
  assert.match(manifest, /#EXT-X-PROGRAM-DATE-TIME:2026-08-06T00:00:48\.000Z/);
  const mapUrl = new URL(manifest.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1]);
  assert.equal(verifySignedPath({ secret, pathname: mapUrl.pathname, expiresAt: Number(mapUrl.searchParams.get('exp')), signature: mapUrl.searchParams.get('sig'), now: Math.floor((epoch + 50_000) / 1000) }), true);
});

test('keeps a retained segment on the same discontinuity sequence across window reloads', () => {
  const item = variableMetadata();
  const epoch = item.epochMs;
  const before = renderManifest({ metadata: item, origin: 'https://stream.example.test', secret, nowMs: epoch + 62_000, windowSegments: 6 });
  const after = renderManifest({ metadata: item, origin: 'https://stream.example.test', secret, nowMs: epoch + 65_000, windowSegments: 6 });

  assert.match(before, /#EXT-X-DISCONTINUITY-SEQUENCE:1\n#EXT-X-MEDIA-SEQUENCE:6/);
  assert.match(after, /#EXT-X-DISCONTINUITY-SEQUENCE:2\n#EXT-X-MEDIA-SEQUENCE:7/);
  // Sequence 7 is retained. Its effective discontinuity number is the base
  // plus explicit tags before it: 1 + 1 before, then 2 + 0 after.
  const effectiveSequence = (manifest) => {
    const base = Number(manifest.match(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/)?.[1]);
    const beforeRetainedSegment = manifest.slice(0, manifest.indexOf('00001.m4s'));
    return base + (beforeRetainedSegment.match(/#EXT-X-DISCONTINUITY\n/g) ?? []).length;
  };
  assert.equal(effectiveSequence(before), 2);
  assert.equal(effectiveSequence(after), 2);
});
