import assert from 'node:assert/strict';
import test from 'node:test';
import { assertUnchangedInfrastructure, compose_replace } from '../../../ops/analytics/analytics-delivery-state.mjs';

const baseline = () => ({services: {postgres: {image: 'postgres@sha256:fixed', volumes: ['/data:/var/lib/postgresql/data']}, collector: {image: 'old'}}, networks: {database: {internal: true}}});

test('application updates preserve database and network definitions', () => {
  const next = baseline();
  next.services.collector.image = 'new';
  assert.doesNotThrow(() => assertUnchangedInfrastructure(baseline(), next));
  for (const mutate of [
    value => { value.services.postgres.image = 'different'; },
    value => { value.services.postgres.volumes = ['/different:/var/lib/postgresql/data']; },
    value => { value.networks.database.internal = false; },
    value => { delete value.services.postgres; },
  ]) {
    const changed = baseline(); mutate(changed);
    assert.throws(() => assertUnchangedInfrastructure(baseline(), changed), /cannot change/);
  }
});

test('replacement targets only the applications and excludes dependency recreation', () => {
  const calls = [];
  compose_replace('/trusted/compose.yml', {sourceSha: 'candidate'}, (...args) => calls.push(args));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][2].slice(-2), ['collector', 'worker']);
  assert.ok(calls[0][2].includes('--no-deps'));
  assert.ok(calls[0][2].includes('--wait'));
  assert.equal(calls[0][2][calls[0][2].indexOf('--wait-timeout') + 1], '120');
  assert.ok(!calls[0][2].includes('postgres'));
});
