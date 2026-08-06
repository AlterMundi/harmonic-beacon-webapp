import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import { decodeManifest, mintManifestUrl, parseManifest } from '../canary/canary-exporter.mjs';

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

test('hands the private manifest to a bounded decoder and removes it afterwards', async () => {
  let temporaryManifest = '';
  await decodeManifest('#EXTM3U\n#EXT-X-ENDLIST\n', async (command, args, options) => {
    assert.equal(command, 'ffmpeg');
    assert.equal(args.includes('-xerror'), true);
    assert.equal(args.includes('-threads'), true);
    assert.equal(options.timeout > 0, true);
    temporaryManifest = args[args.indexOf('-i') + 1];
    assert.equal(await fs.readFile(temporaryManifest, 'utf8'), '#EXTM3U\n#EXT-X-ENDLIST\n');
  });
  await assert.rejects(fs.stat(temporaryManifest), { code: 'ENOENT' });
});
