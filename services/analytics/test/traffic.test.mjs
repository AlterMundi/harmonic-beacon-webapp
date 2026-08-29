import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyLinkedTraffic, parseInternalSubjects } from '../src/traffic.mjs';

test('internal subject parsing accepts only opaque canonical digests', () => {
    const internal = parseInternalSubjects(` ${'a'.repeat(64)},email@example.com,${'B'.repeat(64)},${'b'.repeat(64)} `);
    assert.deepEqual([...internal], ['a'.repeat(64), 'b'.repeat(64)]);
});

test('server identity links canonically classify internal and real traffic', () => {
    const staff = 'a'.repeat(64);
    const publicAccount = 'b'.repeat(64);
    const internal = new Set([staff]);
    assert.equal(classifyLinkedTraffic(staff, 'unknown', internal), 'internal');
    assert.equal(classifyLinkedTraffic(publicAccount, 'unknown', internal), 'real');
    assert.equal(classifyLinkedTraffic(staff, 'test', internal), 'test');
    assert.equal(classifyLinkedTraffic(staff, 'synthetic', internal), 'synthetic');
});
