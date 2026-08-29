import assert from 'node:assert/strict';
import test from 'node:test';

import { lookupGeo, normalizedClientIp, openGeoDatabase } from '../src/geoip.mjs';

test('normalizes only valid first-hop IPv4 and IPv6 addresses', () => {
    assert.equal(normalizedClientIp('203.0.113.8, 10.0.0.1'), '203.0.113.8');
    assert.equal(normalizedClientIp('::ffff:203.0.113.8'), '203.0.113.8');
    assert.equal(normalizedClientIp('2001:db8::8'), '2001:db8::8');
    assert.equal(normalizedClientIp('spoofed'), null);
});

test('extracts bounded country and region codes without retaining the address', () => {
    const reader = { get: () => ({ country: { iso_code: 'ar' }, subdivisions: [{ iso_code: 'x' }] }) };
    assert.deepEqual(lookupGeo(reader, '203.0.113.8'), { countryCode: 'AR', regionCode: 'X' });
    assert.deepEqual(lookupGeo({ get: () => { throw new Error('not found'); } }, '203.0.113.9'), {
        countryCode: null, regionCode: null,
    });
});

test('a missing database degrades enrichment without breaking collection', async () => {
    assert.equal(await openGeoDatabase('/definitely/not/a/geoip-database.mmdb'), null);
    assert.deepEqual(lookupGeo(null, null), { countryCode: null, regionCode: null });
});
