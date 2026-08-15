import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { MediaGrantRegistry, MEDIA_GRANT_MAX_TTL_MS } from '../src/media-grants.mjs';

const id = 'a'.repeat(64);
const token = 'b'.repeat(43);
const hash = createHash('sha256').update(token).digest('hex');

test('media grants are bounded, monotonic, opaque and expire fail-closed', () => {
  let now = 1_800_000_000_000;
  const registry = new MediaGrantRegistry({ now: () => now, maxEntries: 1 });
  assert.deepEqual(registry.upsert({ id, tokenSha256: hash, expiresAtMs: now + 60_000 }), { ok: true });
  assert.equal(registry.authorize({ id, token }), true);
  assert.equal(registry.authorize({ id, token: 'c'.repeat(43) }), false);
  assert.deepEqual(registry.upsert({ id, tokenSha256: hash, expiresAtMs: now + 30_000 }), { ok: true });
  assert.deepEqual(registry.upsert({ id, tokenSha256: 'd'.repeat(64), expiresAtMs: now + 60_000 }), { ok: false, reason: 'conflict' });
  assert.deepEqual(registry.upsert({ id: 'e'.repeat(64), tokenSha256: hash, expiresAtMs: now + 60_000 }), { ok: false, reason: 'capacity' });
  assert.deepEqual(registry.upsert({ id: 'f'.repeat(64), tokenSha256: hash, expiresAtMs: now + MEDIA_GRANT_MAX_TTL_MS + 1 }), { ok: false, reason: 'invalid' });
  now += 60_001;
  assert.equal(registry.authorize({ id, token }), false);
  assert.equal(registry.size, 0);
});

