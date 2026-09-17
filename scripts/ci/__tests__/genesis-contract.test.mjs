import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');

test('published genesis admission schema is closed recursively and matches all three discriminators', () => {
  const path = new URL('../../../deploy/schemas/genesis-admission.schema.json', import.meta.url);
  assert.ok(existsSync(path), 'genesis admission schema is missing');
  const ajv = new Ajv2020({ strict: true }); addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(path)));
  for (const value of [observation(), authorization(), authorization('genesis-recover'), authorization('genesis-forward-repair'), rehearsal()]) {
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    const visit = (node, parts = []) => {
      if (!node || typeof node !== 'object') return;
      if (!Array.isArray(node)) {
        for (const mode of ['extra', ...Object.keys(node)]) {
          const altered = structuredClone(value);
          const target = parts.reduce((o, key) => o[key], altered);
          if (mode === 'extra') target.unreviewedCommand = 'exec'; else delete target[mode];
          assert.equal(validate(altered), false, `${value.schemaVersion}:${parts.join('.')}:${mode}`);
        }
      }
      for (const [key, item] of Object.entries(node)) visit(item, [...parts, key]);
    };
    visit(value);
  }
  for (const mutate of [v => { v.expectedPublication = authorization('genesis-recover').expectedPublication; }, v => { v.verbs = ['exec']; }, v => { v.operation = 'promote'; }, v => { v.manifestSha256 = H('bad-domain'); }]) {
    const a = authorization(); mutate(a); assert.equal(validate(a), false);
  }
});
import { observation, authorization, rehearsal, NOW, bytes, H } from './genesis-fixture.mjs';

const contract = await import('../genesis-contract.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});

test('admission observation is canonical, closed, sanitized and six-service only (not host attestation)', () => {
  assert.equal(typeof contract.validateLegacyObservation, 'function', 'observation validator is missing');
  const o = observation();
  assert.deepEqual(contract.validateLegacyObservation(bytes(o), { now: NOW }), o);
  const reject = mutate => {
    const changed = structuredClone(o); mutate(changed);
    assert.throws(() => contract.validateLegacyObservation(bytes(changed), { now: NOW }));
  };
  for (const key of Object.keys(o)) reject(v => { delete v[key]; });
  reject(v => { v.services.analytics = v.services.app; });
  reject(v => { delete v.services.postgres; });
  reject(v => { v.services.app.environment = { TOKEN: 'secret' }; });
  reject(v => { v.services.app.sourceIdentity = { kind: 'known', gitSha: v.reportedAppGitSha }; });
  reject(v => { v.services.postgres.dependencyResolution.indexRef = `evil.invalid/postgres@${H('postgres')}`; });
  reject(v => { v.services.postgres.dependencyResolution.imageId = H('other'); });
  reject(v => { v.services.app.dependencyResolution = v.services.postgres.dependencyResolution; });
  reject(v => { v.services.app.platform = 'linux/arm64'; });
  reject(v => { v.services.app.configuredImage = '$(touch /tmp/unsafe)'; });
  reject(v => { v.services.app.containerId = 'short'; });
  reject(v => { v.profileSha256 = null; v.gateState.genesisId = null; v.gateState.permitSha256 = null; });
  reject(v => { v.gateState.publication = { generation: 1, id: H('id').slice(7), manifestSha256: H('manifest').slice(7) }; });
  reject(v => { v.boundary.realLivekitParticipants = 1; });
  reject(v => { v.boundary.sql = 'SELECT 1'; });
  reject(v => { v.observedAt = new Date(NOW + 1).toISOString(); });
  reject(v => { v.observedAt = new Date(NOW - 900001).toISOString(); });
  assert.throws(() => contract.validateLegacyObservation(Buffer.from(JSON.stringify(o)), { now: NOW }));
  assert.throws(() => contract.validateLegacyObservation(Buffer.alloc(1048577), { now: NOW }));
});


test('genesis authorization separates initial absence from exact recovery and forward-repair expectations', () => {
  assert.equal(typeof contract.validateGenesisAuthorization, 'function', 'authorization validator is missing');
  for (const operation of ['genesis', 'genesis-recover', 'genesis-forward-repair']) {
    const a = authorization(operation);
    assert.deepEqual(contract.validateGenesisAuthorization(bytes(a), { operation, sourceSha: a.sourceSha }, { now: NOW }), a);
    const reject = mutate => { const changed = structuredClone(a); mutate(changed); assert.throws(() => contract.validateGenesisAuthorization(bytes(changed), {}, { now: NOW })); };
    for (const key of Object.keys(a)) reject(v => { delete v[key]; });
    reject(v => { v.expectedPublication = operation === 'genesis' ? authorization('genesis-recover').expectedPublication : null; });
    reject(v => { v.expectedLedgerSha256 = operation === 'genesis' ? H('ledger') : null; });
    reject(v => { v.verbs.push('exec'); });
    reject(v => { v.verbs.reverse(); });
    reject(v => { v.environment = 'shadow'; });
    reject(v => { v.workflowRef = 'refs/heads/evil'; });
    reject(v => { v.candidateRunAttempt = '1'; });
    reject(v => { v.deliveryRunId = '01'; });
    reject(v => { v.authorizedAt = new Date(NOW + 1).toISOString(); });
    reject(v => { v.expiresAt = new Date(NOW + 900001).toISOString(); });
    reject(v => { v.expiresAt = v.authorizedAt; });
    reject(v => { v.path = '/tmp/root-shell'; });
    reject(v => { v.manifestSha256 = H('prefixed-wrong-domain'); });
    if (operation !== 'genesis') reject(v => { v.expectedPublication.manifestSha256 = H('successor').slice(7); });
    assert.throws(() => contract.validateGenesisAuthorization(bytes(a), { deliveryRunAttempt: 3 }, { now: NOW }));
    assert.throws(() => contract.validateGenesisAuthorization(bytes(a), {}, { now: NOW + 900000 }));
    assert.throws(() => contract.validateGenesisAuthorization(bytes(a), {}, { now: NaN }));
  }
});


test('hosted rehearsal binds exact delivery/candidate attempts and only synthetic measured mechanics', () => {
  assert.equal(typeof contract.validateGenesisRehearsal, 'function', 'rehearsal validator is missing');
  const r = rehearsal();
  assert.deepEqual(contract.validateGenesisRehearsal(bytes(r), { deliveryRunAttempt: 2 }, { now: NOW }), r);
  const reject = mutate => { const v = structuredClone(r); mutate(v); assert.throws(() => contract.validateGenesisRehearsal(bytes(v), {}, { now: NOW })); };
  for (const key of Object.keys(r)) reject(v => { delete v[key]; });
  reject(v => { v.scope = 'mona-isolated-exact'; });
  reject(v => { v.fixtureIdentity.kind = 'mona-historical-images'; });
  reject(v => { v.stages.reverse(); });
  reject(v => { v.stages[1].to = 'genesis'; });
  reject(v => { v.stages[1].commandReceiptSha256 = null; });
  reject(v => { v.stages[1].result = 'skipped'; });
  reject(v => { v.failureRecovery.result = 'failed'; });
  reject(v => { v.failureRecovery.scenario = 'none'; });
  reject(v => { v.stages[0].command = 'sh -c evil'; });
  reject(v => { v.stages[1].startedAt = v.stages[0].startedAt; });
  reject(v => { v.issuedAt = new Date(NOW + 1).toISOString(); });
  reject(v => { v.completedAt = v.startedAt; });
  reject(v => { v.failureRecovery.completedAt = v.issuedAt; });
  assert.throws(() => contract.validateGenesisRehearsal(bytes(r), { candidateRunAttempt: 2 }, { now: NOW }));
  assert.throws(() => contract.validateGenesisRehearsal(bytes(r), {}, { now: NOW + 86400001 }));
});
