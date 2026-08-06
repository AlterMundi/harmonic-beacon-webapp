import assert from 'node:assert/strict';
import test from 'node:test';
import { signPath, verifySignedPath } from '../src/auth.mjs';

const secret = 'x'.repeat(32);
const pathname = '/v1/hls/approved-v1/live.m3u8';

test('validates a short-lived canonical signed path', () => {
  const signature = signPath({ secret, pathname, expiresAt: 1_100 });
  assert.equal(verifySignedPath({ secret, pathname, expiresAt: 1_100, signature, now: 1_000 }), true);
});

test('rejects altered, expired and excessively distant signed paths', () => {
  const signature = signPath({ secret, pathname, expiresAt: 1_100 });
  assert.equal(verifySignedPath({ secret, pathname: `${pathname}/other`, expiresAt: 1_100, signature, now: 1_000 }), false);
  assert.equal(verifySignedPath({ secret, pathname, expiresAt: 1_000, signature, now: 1_000 }), false);
  const farSignature = signPath({ secret, pathname, expiresAt: 2_000 });
  assert.equal(verifySignedPath({ secret, pathname, expiresAt: 2_000, signature: farSignature, now: 1_000 }), false);
});
