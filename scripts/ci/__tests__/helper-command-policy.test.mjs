import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync('deploy/beacon-runner.sudoers', 'utf8');
const promotion = readFileSync('.github/workflows/oci-promote.yml', 'utf8');
const alias = policy.match(/^Cmnd_Alias HARMONIC_BEACON_DEPLOY = (.+)$/m)?.[1];
const entries = alias?.split(', ').map(entry => entry.trim()) ?? [];

test('every promotion helper verb has explicit sudo admission', () => {
  const verbs = [...promotion.matchAll(/sudo \/usr\/local\/sbin\/hb-deploy ([a-z-]+)/g)]
    .map(match => match[1]);
  assert.ok(verbs.includes('artifact-impact-state'));
  assert.ok(verbs.includes('artifact-impact'));
  for (const verb of new Set(verbs)) {
    assert.ok(entries.some(entry => entry === `/usr/local/sbin/hb-deploy ${verb}`
      || entry === `/usr/local/sbin/hb-deploy ${verb} *`), `missing sudo admission: ${verb}`);
  }
});

test('runner sudo policy grants only individually named restricted helper verbs', () => {
  const allowed = new Set(['health', 'boundary', 'host-readback', 'artifact-impact-state', 'artifact-prepare',
    'artifact-impact', 'artifact-preflight', 'artifact-migrate', 'artifact-replace',
    'artifact-status', 'artifact-rollback', 'artifact-authorize-rollback']);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    const match = entry.match(/^\/usr\/local\/sbin\/hb-deploy ([a-z-]+)(?: \*)?$/);
    assert.ok(match && allowed.has(match[1]), `unexpected sudo entry: ${entry}`);
  }
  assert.match(policy, /NOPASSWD:NOSETENV: HARMONIC_BEACON_DEPLOY/);
  assert.match(policy, /Defaults:beacon-runner !setenv/);
});

test('host readback has an explicit verb and no wildcard command surface', () => {
  const workflow = readFileSync('.github/workflows/live-host-readback.yml', 'utf8');
  assert.match(workflow, /sudo \/usr\/local\/sbin\/hb-deploy host-readback/);
  assert.ok(entries.includes('/usr/local/sbin/hb-deploy host-readback'));
  assert.ok(!entries.includes('/usr/local/sbin/hb-deploy host-readback *'));
});
