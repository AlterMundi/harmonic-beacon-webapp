import assert from 'node:assert/strict';
import test from 'node:test';
import { parseManifest } from '../canary/canary-exporter.mjs';

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
