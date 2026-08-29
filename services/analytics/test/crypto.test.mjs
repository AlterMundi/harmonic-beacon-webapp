import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { signHandoff, verifyHandoff, verifyServerSignature } from '../src/crypto.mjs';

const secret = 'x'.repeat(48);

test('handoff is signed, bounded and expires', () => {
    const token = signHandoff({ v: 'visitor', s: 'session' }, secret, 1_000_000);
    assert.equal(verifyHandoff(token, secret, 1_000_001).v, 'visitor');
    assert.equal(verifyHandoff(`${token}x`, secret, 1_000_001), null);
    assert.equal(verifyHandoff(token, secret, 1_901_000), null);
});

test('server signature binds timestamp and exact body', () => {
    const timestamp = '1000';
    const body = '{"event":1}';
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    assert.equal(verifyServerSignature({ timestamp, signature, body, secret, now: 1_000_000 }), true);
    assert.equal(verifyServerSignature({ timestamp, signature, body: `${body} `, secret, now: 1_000_000 }), false);
    assert.equal(verifyServerSignature({ timestamp, signature, body, secret, now: 1_400_000 }), false);
});
