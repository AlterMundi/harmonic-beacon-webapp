import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCatalog } from '../hb-doctor.mjs';

const valid = {
  schemaVersion: 1,
  services: [{
    id: 'live',
    name: 'Live',
    repository: 'AlterMundi/harmonic-beacon-webapp',
    lanes: ['main'],
    localPaths: ['src'],
    workflows: [],
    health: [{ name: 'ready', url: 'https://example.com/ready', expectStatus: [200] }],
    recoveryDocs: [],
    alerts: 'alerts',
    runner: 'runner',
    mutation: 'workflow only',
  }],
};

test('accepts the versioned catalog contract', () => {
  const catalog = structuredClone(valid);
  assert.equal(validateCatalog(catalog), catalog);
});

test('rejects duplicate service identifiers', () => {
  const catalog = structuredClone(valid);
  catalog.services.push(structuredClone(catalog.services[0]));
  assert.throws(() => validateCatalog(catalog), /duplicate service id/);
});

test('rejects non-HTTPS health endpoints', () => {
  const catalog = structuredClone(valid);
  catalog.services[0].health[0].url = 'http://example.com/ready';
  assert.throws(() => validateCatalog(catalog), /invalid health endpoint/);
});
