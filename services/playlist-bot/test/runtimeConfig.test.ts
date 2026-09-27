import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requiredLivekitUrl } from '../src/runtimeConfig.js';

test('requires an explicit endpoint without leaking invalid values', () => {
  for (const value of [undefined, '', ' ', 'invalid-secret', 'https://example.test', 'wss://user:secret@example.test']) {
    assert.throws(() => requiredLivekitUrl({ LIVEKIT_URL: value }), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('invalid-secret'));
      assert.ok(!error.message.includes('user:secret'));
      return true;
    });
  }
});

test('preserves explicit production and isolated rehearsal endpoints', () => {
  assert.equal(requiredLivekitUrl({ LIVEKIT_URL: 'wss://live.example.test/rtc' }), 'wss://live.example.test/rtc');
  assert.equal(requiredLivekitUrl({ LIVEKIT_URL: 'ws://livekit:7880' }), 'ws://livekit:7880');
});
