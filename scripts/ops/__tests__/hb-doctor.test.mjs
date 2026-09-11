import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import {
  evaluateDeliveryProtection,
  githubContentsExist,
  inspect,
  inspectBranchSource,
  inspectLocalRoutes,
  STRICT_HTTPS_REFERENCE_PATTERN_SOURCE,
  STRICT_HTTPS_URL_PATTERN_SOURCE,
  validateCatalog,
} from '../hb-doctor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const fixture = (name) => JSON.parse(readFileSync(resolve(HERE, 'fixtures', name), 'utf8'));
const catalog = () => JSON.parse(readFileSync(resolve(REPO_ROOT, 'deploy/platform-services.json'), 'utf8'));
const schema = () => JSON.parse(readFileSync(resolve(REPO_ROOT, 'deploy/schemas/platform-services.schema.json'), 'utf8'));

function schemaValidity(values) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addKeyword({ keyword: 'x-runtimeLimits', schemaType: 'object' });
  addFormats(ajv);
  const validate = ajv.compile(schema());
  return values.map((value) => validate(value));
}

function outcome(kind = 'recipient-delivery') {
  return {
    kind,
    serviceId: 'live',
    id: 'run-42',
    result: 'succeeded',
    observedAt: '2026-09-10T12:00:00Z',
    reference: 'docs/ops/OPERATING_CONTRACT.md',
    contentSha256: 'd'.repeat(64),
  };
}

const DIRECT_DOCTOR = resolve(REPO_ROOT, 'scripts/ops/hb-doctor.mjs');
const HB_WRAPPER = resolve(REPO_ROOT, 'scripts/hb.mjs');

function doctorProbe(entry, catalogPath, extra = []) {
  const args = entry === HB_WRAPPER
    ? [entry, 'doctor', '--catalog', catalogPath, '--offline', ...extra]
    : [entry, '--catalog', catalogPath, '--offline', ...extra];
  return spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

const valid = {
  schemaVersion: 2,
  services: [{
    id: 'live',
    name: 'Live',
    owner: { status: 'verified', name: 'AlterMundi' },
    repository: { status: 'verified', slug: 'AlterMundi/harmonic-beacon-webapp' },
    integrationLane: { status: 'verified', name: 'main' },
    deliveryLane: { status: 'verified', name: 'release' },
    ciWorkflow: { status: 'verified', path: '.github/workflows/ci.yml' },
    deployAdapter: { status: 'verified', kind: 'github-actions-workflow', references: ['.github/workflows/deploy.yml'] },
    localPaths: ['src'],
    workflows: ['.github/workflows/ci.yml'],
    branchSources: [],
    recoveryDocs: [],
    deployedRevision: { status: 'unresolved', value: null },
    artifactFingerprint: { status: 'unresolved', kind: 'oci-digest', value: null, references: [] },
    health: {
      status: 'verified',
      endpoints: [{ name: 'ready', url: 'https://example.com/ready', expectStatus: [200] }],
    },
    alerts: {
      route: { status: 'documented', kind: 'service-monitor', references: [] },
      recipientProof: { status: 'unresolved', references: [], outcome: null },
    },
    recovery: {
      target: { status: 'documented', kind: 'prior-artifact', references: [] },
      proof: { status: 'unresolved', references: [], outcome: null },
    },
    staging: {
      status: 'verified',
      environments: [{ name: 'staging', url: 'https://example.com/' }],
      drill: { status: 'unresolved', references: [], outcome: null },
    },
    unresolvedRequirements: [],
    mutationPolicy: 'workflow only',
  }],
};

const offlineOptions = {
  services: [],
  noGithub: true,
  noHealth: true,
  strict: false,
  githubUser: null,
};

test('accepts the versioned typed catalog contract', () => {
  const value = structuredClone(valid);
  assert.equal(validateCatalog(value), value);
});

test('uses the declared locked Draft 2020-12 validator from the ops test environment', () => {
  const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(manifest.devDependencies.ajv, '8.20.0');
  assert.equal(manifest.devDependencies['ajv-formats'], '3.0.1');
  assert.deepEqual(
    [lock.packages['node_modules/ajv'].version, lock.packages['node_modules/ajv'].integrity],
    ['8.20.0', 'sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA=='],
  );
  assert.deepEqual(
    [lock.packages['node_modules/ajv-formats'].version, lock.packages['node_modules/ajv-formats'].integrity],
    ['3.0.1', 'sha512-8iUql50EUR+uUcdRQ3HDqa6EVyo3docL8g5WJ3FNcWmu62IbkGUue/pEyLBW8VGKKucTPgqeks4fIU1DA4yowQ=='],
  );
  assert.deepEqual(schemaValidity([structuredClone(valid)]), [true]);
});

test('enforces documented catalog, collection, aggregate, and report boundaries at limit plus one', async (t) => {
  const limits = {
    catalogBytes: 1048576,
    services: 64,
    endpointsPerService: 32,
    environmentsPerService: 32,
    requirementsPerService: 32,
    aggregateChecks: 1024,
    reportEntries: 2048,
  };
  const contract = schema();
  assert.deepEqual(contract['x-runtimeLimits'], limits);
  assert.equal(contract.properties.services.maxItems, limits.services);
  assert.equal(contract.$defs.health.properties.endpoints.maxItems, limits.endpointsPerService);
  assert.equal(contract.$defs.staging.properties.environments.maxItems, limits.environmentsPerService);
  assert.equal(contract.properties.services.items.properties.unresolvedRequirements.maxItems, limits.requirementsPerService);

  const serviceBoundary = structuredClone(valid);
  serviceBoundary.services = Array.from({ length: limits.services }, (_, index) => ({
    ...structuredClone(valid.services[0]), id: `service-${index}`,
  }));
  assert.equal(validateCatalog(serviceBoundary), serviceBoundary);
  const tooManyServices = structuredClone(serviceBoundary);
  tooManyServices.services.push({ ...structuredClone(valid.services[0]), id: 'service-overflow' });
  assert.throws(() => validateCatalog(tooManyServices), /at most 64 services/);
  assert.deepEqual(schemaValidity([serviceBoundary, tooManyServices]), [true, false]);

  for (const [label, select, make] of [
    ['endpoints', (service) => service.health.endpoints, (index) => ({ name: `ready-${index}`, url: `https://example.com/ready-${index}`, expectStatus: [200] })],
    ['environments', (service) => service.staging.environments, (index) => ({ name: `stage-${index}`, url: `https://stage-${index}.example.com/` })],
    ['requirements', (service) => service.unresolvedRequirements, (index) => ({
      id: `gap-${index}`, kind: 'repository-access', status: 'unresolved', owner: 'owner',
      blocks: ['delivery-proof'], reference: `docs/gap-${index}.md`,
    })],
  ]) {
    const value = structuredClone(valid);
    const items = select(value.services[0]);
    items.splice(0, items.length, ...Array.from({ length: limits[`${label}PerService`] }, (_, index) => make(index)));
    assert.equal(validateCatalog(value), value);
    items.push(make(limits[`${label}PerService`]));
    assert.throws(() => validateCatalog(value), /at most 32/);
    assert.deepEqual(schemaValidity([value]), [false]);
  }

  const aggregateBoundary = structuredClone(valid);
  aggregateBoundary.services = Array.from({ length: 32 }, (_, serviceIndex) => {
    const service = structuredClone(valid.services[0]);
    service.id = `aggregate-${serviceIndex}`;
    service.health.endpoints = Array.from({ length: 32 }, (_, endpointIndex) => ({
      name: `ready-${endpointIndex}`, url: `https://s${serviceIndex}.example.com/ready-${endpointIndex}`, expectStatus: [200],
    }));
    service.staging = { status: 'unavailable', environments: [], drill: { status: 'unresolved', references: [], outcome: null } };
    return service;
  });
  assert.equal(validateCatalog(aggregateBoundary), aggregateBoundary);
  aggregateBoundary.services[0].staging = {
    status: 'verified', environments: [{ name: 'overflow', url: 'https://overflow.example.com/' }],
    drill: { status: 'unresolved', references: [], outcome: null },
  };
  assert.throws(() => validateCatalog(aggregateBoundary), /aggregate checks must not exceed 1024/);

  const missingAtLimit = Array.from({ length: limits.reportEntries - 2 }, (_, index) => `missing-${index}`);
  const report = await inspect({ catalog: structuredClone(valid), options: { ...offlineOptions, services: missingAtLimit } });
  assert.equal(report.results.length, limits.reportEntries);
  await assert.rejects(
    inspect({ catalog: structuredClone(valid), options: { ...offlineOptions, services: [...missingAtLimit, 'missing-overflow'] } }),
    /report entries must not exceed 2048/,
  );

  const exploit = structuredClone(valid);
  exploit.services[0].health.endpoints = Array.from({ length: 512 }, (_, index) => ({
    name: `exploit-${index}`, url: `https://example.com/exploit-${index}`, expectStatus: [200],
  }));
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; throw new Error('must not fetch'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(inspect({ catalog: exploit, options: { ...offlineOptions, noHealth: false } }), /at most 32 endpoints/);
  assert.equal(fetched, false);

  const directory = mkdtempSync(join(tmpdir(), 'hb-doctor-size-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const serialized = JSON.stringify(valid);
  for (const [name, bytes] of [['at-limit.json', limits.catalogBytes], ['over-limit.json', limits.catalogBytes + 1]]) {
    writeFileSync(join(directory, name), serialized + ' '.repeat(bytes - Buffer.byteLength(serialized)));
  }
  const atLimit = doctorProbe(DIRECT_DOCTOR, join(directory, 'at-limit.json'), ['--json']);
  assert.equal(atLimit.status, 1);
  assert.equal(atLimit.stderr, '');
  assert.equal(JSON.parse(atLimit.stdout).schemaVersion, 2);
  const overLimit = doctorProbe(DIRECT_DOCTOR, join(directory, 'over-limit.json'), ['--json']);
  assert.equal(overLimit.status, 1);
  assert.equal(overLimit.stdout, '');
  assert.equal(overLimit.stderr, 'hb doctor: catalog could not be read or validated\n');
});

test('rejects duplicate service identifiers', () => {
  const value = structuredClone(valid);
  value.services.push(structuredClone(value.services[0]));
  assert.throws(() => validateCatalog(value), /duplicate service id/);
});

test('rejects non-HTTPS health endpoints', () => {
  const value = structuredClone(valid);
  value.services[0].health.endpoints[0].url = 'http://example.com/ready';
  assert.throws(() => validateCatalog(value), /invalid health endpoint/);
});

test('accepts an HTTPS reference fragment without a path', () => {
  const value = structuredClone(valid);
  value.services[0].deployAdapter.references = ['https://example.com#receipt'];
  assert.equal(validateCatalog(value), value);
  assert.deepEqual(schemaValidity([value]), [true]);
});

test('schema and runtime reject reordered structural duplicates and ambiguous URLs', () => {
  assert.equal(schema().$defs.httpsUrl.pattern, STRICT_HTTPS_URL_PATTERN_SOURCE);
  assert.equal(schema().$defs.httpsReference.pattern, STRICT_HTTPS_REFERENCE_PATTERN_SOURCE);
  const mutations = [
    ['reordered endpoint duplicate', (value) => {
      value.services[0].health.endpoints.push({
        expectStatus: [200], url: 'https://example.com/ready', name: 'ready',
      });
    }],
    ['reordered staging duplicate', (value) => {
      value.services[0].staging.environments.push({ url: 'https://example.com/', name: 'staging' });
    }],
    ['invalid IPv4 hostname', (value) => { value.services[0].health.endpoints[0].url = 'https://999.999.999.999/ready'; }],
    ['hexadecimal IPv4 number', (value) => { value.services[0].health.endpoints[0].url = 'https://0x7f000001/ready'; }],
    ['mixed hexadecimal IPv4 number', (value) => { value.services[0].health.endpoints[0].url = 'https://0x7f.1/ready'; }],
    ['invalid percent escape', (value) => { value.services[0].health.endpoints[0].url = 'https://example.com/%zz'; }],
    ['backslash normalization', (value) => { value.services[0].health.endpoints[0].url = 'https://example.com\\evil/ready'; }],
    ['percent-encoded control', (value) => { value.services[0].health.endpoints[0].url = 'https://example.com/%0Aready'; }],
    ['dot-segment normalization', (value) => { value.services[0].health.endpoints[0].url = 'https://example.com/a/../ready'; }],
    ['encoded path separator ambiguity', (value) => { value.services[0].health.endpoints[0].url = 'https://example.com/a%2Fready'; }],
  ];
  const values = mutations.map(([, mutate]) => {
    const value = structuredClone(valid);
    mutate(value);
    return value;
  });
  const schemaAccepted = schemaValidity(values)
    .map((accepted, index) => accepted ? mutations[index][0] : null).filter(Boolean);
  const runtimeAccepted = values
    .map((value, index) => {
      try { validateCatalog(value); return mutations[index][0]; } catch { return null; }
    }).filter(Boolean);
  assert.deepEqual({ schemaAccepted, runtimeAccepted }, { schemaAccepted: [], runtimeAccepted: [] });

  const controls = ['https://127.0.0.1/ready', 'https://example.com/ready'].map((url) => {
    const value = structuredClone(valid);
    value.services[0].health.endpoints[0].url = url;
    return value;
  });
  assert.deepEqual(schemaValidity(controls), [true, true]);
  for (const value of controls) assert.equal(validateCatalog(value), value);
});

test('Draft 2020-12 schema and runtime reject the permanent malformed mutation corpus', () => {
  const mutations = [
    ['unknown root key', (value) => { value.extra = true; }],
    ['unknown service key', (value) => { value.services[0].extra = true; }],
    ['unknown owner key', (value) => { value.services[0].owner.extra = true; }],
    ['unknown repository key', (value) => { value.services[0].repository.extra = true; }],
    ['unknown lane key', (value) => { value.services[0].integrationLane.extra = true; }],
    ['unknown workflow key', (value) => { value.services[0].ciWorkflow.extra = true; }],
    ['unknown deploy adapter key', (value) => { value.services[0].deployAdapter.extra = true; }],
    ['unknown revision key', (value) => { value.services[0].deployedRevision.extra = true; }],
    ['unknown artifact key', (value) => { value.services[0].artifactFingerprint.extra = true; }],
    ['unknown health key', (value) => { value.services[0].health.extra = true; }],
    ['unknown endpoint key', (value) => { value.services[0].health.endpoints[0].extra = true; }],
    ['unknown alerts key', (value) => { value.services[0].alerts.extra = true; }],
    ['unknown proof key', (value) => { value.services[0].alerts.recipientProof.extra = true; }],
    ['unknown outcome key', (value) => {
      value.services[0].alerts.recipientProof.outcome = { ...outcome(), extra: true };
    }],
    ['verified proof outcome kind mismatch', (value) => {
      value.services[0].alerts.recipientProof = {
        status: 'verified', references: ['docs/ops/OPERATING_CONTRACT.md'],
        outcome: outcome('recovery-exercise'),
      };
    }],
    ['verified proof outcome missing receipt', (value) => {
      const evidence = outcome();
      delete evidence.id;
      value.services[0].alerts.recipientProof = {
        status: 'verified', references: ['docs/ops/OPERATING_CONTRACT.md'], outcome: evidence,
      };
    }],
    ['verified proof outcome failed', (value) => {
      value.services[0].alerts.recipientProof = {
        status: 'verified', references: ['docs/ops/OPERATING_CONTRACT.md'],
        outcome: { ...outcome(), result: 'failed' },
      };
    }],
    ['verified proof outcome impossible date', (value) => {
      value.services[0].alerts.recipientProof = {
        status: 'verified', references: ['docs/ops/OPERATING_CONTRACT.md'],
        outcome: { ...outcome(), observedAt: '2026-02-30T12:00:00Z' },
      };
    }],
    ['verified proof outcome malformed reference', (value) => {
      value.services[0].alerts.recipientProof = {
        status: 'verified', references: ['docs/ops/OPERATING_CONTRACT.md'],
        outcome: { ...outcome(), reference: 'https://' },
      };
    }],
    ['verified proof outcome malformed content binding', (value) => {
      value.services[0].alerts.recipientProof = {
        status: 'verified', references: ['docs/ops/OPERATING_CONTRACT.md'],
        outcome: { ...outcome(), contentSha256: 'not-a-sha256' },
      };
    }],
    ['unknown recovery key', (value) => { value.services[0].recovery.extra = true; }],
    ['unknown recovery target key', (value) => { value.services[0].recovery.target.extra = true; }],
    ['unknown staging key', (value) => { value.services[0].staging.extra = true; }],
    ['unknown environment key', (value) => { value.services[0].staging.environments[0].extra = true; }],
    ['unknown requirement key', (value) => {
      value.services[0].unresolvedRequirements = [{
        id: 'gap', kind: 'repository-access', status: 'unresolved', owner: 'owner',
        blocks: ['delivery-proof'], reference: 'docs/ops/OPERATING_CONTRACT.md', extra: true,
      }];
    }],
    ['unknown runner key', (value) => {
      value.services[0].runnerVerification = {
        organization: 'AlterMundi', groupId: 3, groupName: 'group',
        repository: 'AlterMundi/repo', workflow: 'AlterMundi/repo/.github/workflows/deploy.yml@refs/heads/main',
        runnerName: 'runner', labels: ['self-hosted'], extra: true,
      };
    }],
    ['status code is not integer', (value) => { value.services[0].health.endpoints[0].expectStatus = ['200']; }],
    ['status code is fractional', (value) => { value.services[0].health.endpoints[0].expectStatus = [200.5]; }],
    ['status code below range', (value) => { value.services[0].health.endpoints[0].expectStatus = [99]; }],
    ['status code above range', (value) => { value.services[0].health.endpoints[0].expectStatus = [600]; }],
    ['status codes duplicate', (value) => { value.services[0].health.endpoints[0].expectStatus = [200, 200]; }],
    ['status codes empty', (value) => { value.services[0].health.endpoints[0].expectStatus = []; }],
    ['HTTPS URL has no host', (value) => { value.services[0].health.endpoints[0].url = 'https://'; }],
    ['HTTPS URL has credentials', (value) => { value.services[0].health.endpoints[0].url = 'https://user:secret@example.com/'; }],
    ['health URL has fragment', (value) => { value.services[0].health.endpoints[0].url = 'https://example.com/#ready'; }],
    ['health URL has control', (value) => { value.services[0].health.endpoints[0].url = 'https://example.com/\nready'; }],
    ['HTTPS URL has malformed hostname labels', (value) => { value.services[0].health.endpoints[0].url = 'https://example..com/ready'; }],
    ['HTTPS URL has non-ASCII hostname', (value) => { value.services[0].health.endpoints[0].url = 'https://éxample.com/ready'; }],
    ['HTTPS URL has raw whitespace', (value) => { value.services[0].health.endpoints[0].url = 'https://example.com/not ready'; }],
    ['HTTPS URL has out-of-range port', (value) => { value.services[0].health.endpoints[0].url = 'https://example.com:99999/ready'; }],
    ['service array item malformed', (value) => { value.services[0] = null; }],
    ['local paths is not array', (value) => { value.services[0].localPaths = 'src'; }],
    ['local path item malformed', (value) => { value.services[0].localPaths = [42]; }],
    ['local paths duplicate', (value) => { value.services[0].localPaths = ['src', 'src']; }],
    ['references is not array', (value) => { value.services[0].deployAdapter.references = 'docs/ops/OPERATING_CONTRACT.md'; }],
    ['reference item malformed', (value) => { value.services[0].deployAdapter.references = [42]; }],
    ['references duplicate', (value) => {
      value.services[0].deployAdapter.references = ['docs/ops/OPERATING_CONTRACT.md', 'docs/ops/OPERATING_CONTRACT.md'];
    }],
    ['references exceed bound', (value) => {
      value.services[0].deployAdapter.references = Array.from({ length: 17 }, (_, index) => `docs/proof-${index}.md`);
    }],
    ['outcome reference exceeds bound', (value) => {
      value.services[0].alerts.recipientProof = {
        status: 'verified', references: ['docs/ops/OPERATING_CONTRACT.md'],
        outcome: { ...outcome(), reference: `https://example.com/${'a'.repeat(2049)}` },
      };
    }],
    ['health endpoints is not array', (value) => { value.services[0].health.endpoints = {}; }],
    ['health endpoint item malformed', (value) => { value.services[0].health.endpoints = [null]; }],
    ['health endpoints duplicate', (value) => {
      value.services[0].health.endpoints.push(structuredClone(value.services[0].health.endpoints[0]));
    }],
    ['staging environments is not array', (value) => { value.services[0].staging.environments = {}; }],
    ['staging environment item malformed', (value) => { value.services[0].staging.environments = [null]; }],
    ['staging environments duplicate', (value) => {
      value.services[0].staging.environments.push(structuredClone(value.services[0].staging.environments[0]));
    }],
    ['requirements is not array', (value) => { value.services[0].unresolvedRequirements = {}; }],
    ['requirement item malformed', (value) => { value.services[0].unresolvedRequirements = [null]; }],
    ['requirement blocks malformed', (value) => {
      value.services[0].unresolvedRequirements = [{
        id: 'gap', kind: 'repository-access', status: 'unresolved', owner: 'owner',
        blocks: 'delivery-proof', reference: 'docs/ops/OPERATING_CONTRACT.md',
      }];
    }],
    ['requirement blocks duplicate', (value) => {
      value.services[0].unresolvedRequirements = [{
        id: 'gap', kind: 'repository-access', status: 'unresolved', owner: 'owner',
        blocks: ['delivery-proof', 'delivery-proof'], reference: 'docs/ops/OPERATING_CONTRACT.md',
      }];
    }],
    ['runner labels malformed', (value) => {
      value.services[0].runnerVerification = {
        organization: 'AlterMundi', groupId: 3, groupName: 'group',
        repository: 'AlterMundi/repo', workflow: 'AlterMundi/repo/.github/workflows/deploy.yml@refs/heads/main',
        runnerName: 'runner', labels: [42],
      };
    }],
    ['runner object is null', (value) => { value.services[0].runnerVerification = null; }],
  ];
  const values = mutations.map(([, mutate]) => {
    const value = structuredClone(valid);
    mutate(value);
    return value;
  });
  const schemaAccepted = schemaValidity(values)
    .map((accepted, index) => accepted ? mutations[index][0] : null)
    .filter(Boolean);
  const runtimeAccepted = values
    .map((value, index) => {
      try { validateCatalog(value); return mutations[index][0]; } catch { return null; }
    })
    .filter(Boolean);
  assert.deepEqual({ schemaAccepted, runtimeAccepted }, { schemaAccepted: [], runtimeAccepted: [] });
});

test('Draft schema and runtime reject C0, C1, newline, and bidi controls in diagnostic strings', () => {
  const runner = {
    organization: 'AlterMundi', groupId: 3, groupName: 'group', repository: 'AlterMundi/repo',
    workflow: 'AlterMundi/repo/.github/workflows/deploy.yml@refs/heads/main',
    runnerName: 'runner', labels: ['self-hosted'],
  };
  const mutations = [
    ['root schema C0', (value) => { value.$schema = 'schema\u0000'; }],
    ['service name C1', (value) => { value.services[0].name = 'Live\u0085forged'; }],
    ['owner newline', (value) => { value.services[0].owner.name = 'AlterMundi\nOK forged'; }],
    ['owner bidi', (value) => { value.services[0].owner.name = 'AlterMundi\u202eKO'; }],
    ['endpoint name newline', (value) => { value.services[0].health.endpoints[0].name = 'ready\nOK forged'; }],
    ['provenance field C1', (value) => { value.services[0].health.endpoints[0].provenanceField = 'git\u009fsha'; }],
    ['staging name bidi', (value) => { value.services[0].staging.environments[0].name = 'stage\u2066x'; }],
    ['requirement owner C1', (value) => {
      value.services[0].unresolvedRequirements = [{
        id: 'gap', kind: 'repository-access', status: 'unresolved', owner: 'owner\u0085x',
        blocks: ['delivery-proof'], reference: 'docs/ops/OPERATING_CONTRACT.md',
      }];
    }],
    ['mutation policy newline', (value) => { value.services[0].mutationPolicy = 'workflow\nOK forged'; }],
    ['runner organization bidi', (value) => {
      value.services[0].runnerVerification = { ...runner, organization: 'Alter\u202eMundi' };
    }],
    ['runner group newline', (value) => {
      value.services[0].runnerVerification = { ...runner, groupName: 'group\nOK forged' };
    }],
    ['runner workflow C1', (value) => {
      value.services[0].runnerVerification = { ...runner, workflow: 'workflow\u0085forged' };
    }],
    ['runner name C0', (value) => {
      value.services[0].runnerVerification = { ...runner, runnerName: 'runner\u0000forged' };
    }],
    ['runner label bidi', (value) => {
      value.services[0].runnerVerification = { ...runner, labels: ['self-hosted\u200f'] };
    }],
  ];
  const values = mutations.map(([, mutate]) => {
    const value = structuredClone(valid);
    mutate(value);
    return value;
  });
  const schemaAccepted = schemaValidity(values)
    .map((accepted, index) => accepted ? mutations[index][0] : null)
    .filter(Boolean);
  const runtimeAccepted = values
    .map((value, index) => {
      try { validateCatalog(value); return mutations[index][0]; } catch { return null; }
    })
    .filter(Boolean);
  assert.deepEqual({ schemaAccepted, runtimeAccepted }, { schemaAccepted: [], runtimeAccepted: [] });
});

test('direct and wrapper doctor failures emit one bounded generic line without paths or input', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hb-doctor-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const schemaV1 = structuredClone(valid);
  schemaV1.schemaVersion = 1;
  const forged = structuredClone(valid);
  forged.services[0].owner.name = 'AlterMundi\nOK      forged.check: healthy';
  const scenarios = [
    ['schema-v1.json', JSON.stringify(schemaV1)],
    ['invalid.json', '{"private":"/home/operator/private","secret":"TOP_SECRET"'],
    ['forged.json', JSON.stringify(forged)],
  ];
  for (const [name, content] of scenarios) writeFileSync(join(directory, name), content);
  const missing = '/home/private/operator/catalog-does-not-exist.json';
  const paths = [...scenarios.map(([name]) => join(directory, name)), missing];
  for (const entry of [DIRECT_DOCTOR, HB_WRAPPER]) {
    for (const catalogPath of paths) {
      const probe = doctorProbe(entry, catalogPath);
      assert.equal(probe.status, 1, `${entry} ${catalogPath}`);
      assert.equal(probe.stdout, '');
      assert.equal(probe.stderr, 'hb doctor: catalog could not be read or validated\n');
      assert.ok(Buffer.byteLength(probe.stderr) <= 96);
      assert.equal(probe.stderr.trim().split(/\r?\n/).length, 1);
      assert.doesNotMatch(probe.stderr, /\/home\/|TOP_SECRET|forged\.check|platform-services|\.mjs:\d/);
    }
  }
});

test('direct and wrapper preserve machine-readable JSON reports and fail-closed status', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hb-doctor-json-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const catalogPath = join(directory, 'valid.json');
  writeFileSync(catalogPath, JSON.stringify(valid));
  for (const entry of [DIRECT_DOCTOR, HB_WRAPPER]) {
    const probe = doctorProbe(entry, catalogPath, ['--json']);
    assert.equal(probe.status, 1);
    assert.equal(probe.stderr, '');
    const report = JSON.parse(probe.stdout);
    assert.equal(report.schemaVersion, 2);
    assert.ok(report.summary.error > 0);
    assert.deepEqual(report.selectedServices, ['live']);
  }
});

test('rejects malformed typed statuses and private absolute paths', () => {
  const value = fixture('catalog-malformed.json');
  assert.throws(() => validateCatalog(value), /invalid owner status/);
  value.services[0].owner.status = 'verified';
  assert.throws(() => validateCatalog(value), /ciWorkflow\.path must be repository-relative/);
});

test('rejects inherited status names and verified claims without typed evidence', () => {
  let value = structuredClone(valid);
  value.services[0].owner.status = 'toString';
  assert.throws(() => validateCatalog(value), /invalid owner status/);

  value = structuredClone(valid);
  value.services[0].repository.slug = null;
  assert.throws(() => validateCatalog(value), /verified repository requires slug/);

  value = structuredClone(valid);
  value.services[0].artifactFingerprint = {
    status: 'verified',
    kind: 'oci-digest',
    value: null,
    references: ['docs/ops/OPERATING_CONTRACT.md'],
  };
  assert.throws(() => validateCatalog(value), /verified artifact fingerprint requires a concrete value/);

  value = structuredClone(valid);
  value.services[0].health.endpoints = [];
  assert.throws(() => validateCatalog(value), /verified health requires endpoints/);

  value = structuredClone(valid);
  value.services[0].staging.environments = [];
  assert.throws(() => validateCatalog(value), /verified staging requires environments/);
});

test('rejects verified artifact fingerprints with unknown or kind-incompatible values', () => {
  for (const artifactFingerprint of [
    { status: 'verified', kind: 'unknown', value: null, references: ['docs/ops/OPERATING_CONTRACT.md'] },
    { status: 'verified', kind: 'source-public-sha256', value: `sha256:${'a'.repeat(64)}`, references: ['docs/ops/OPERATING_CONTRACT.md'] },
    { status: 'verified', kind: 'oci-digest', value: 'a'.repeat(64), references: ['docs/ops/OPERATING_CONTRACT.md'] },
    { status: 'verified', kind: 'source-revision', value: 'a'.repeat(64), references: ['docs/ops/OPERATING_CONTRACT.md'] },
  ]) {
    const value = structuredClone(valid);
    value.services[0].artifactFingerprint = artifactFingerprint;
    assert.throws(() => validateCatalog(value), /artifact fingerprint/);
  }
});

test('uses one verified-kind rule for every kind-bearing evidence object', () => {
  const cases = [
    (service) => { service.deployAdapter = { status: 'verified', kind: 'unknown', references: ['docs/proof.json'] }; },
    (service) => { service.artifactFingerprint = { status: 'verified', kind: 'unknown', value: null, references: ['docs/proof.json'] }; },
    (service) => { service.alerts.route = { status: 'verified', kind: 'unknown', references: ['docs/proof.json'] }; },
    (service) => { service.recovery.target = { status: 'verified', kind: 'unknown', references: ['docs/proof.json'] }; },
  ];
  const values = cases.map((mutate) => {
    const value = structuredClone(valid);
    mutate(value.services[0]);
    return value;
  });
  assert.deepEqual(schemaValidity(values), [false, false, false, false]);
  for (const value of values) {
    assert.throws(() => validateCatalog(value), /verified .* requires a concrete kind-compatible value or evidence/i);
  }
});

test('accepts concrete kind-compatible verified artifact fingerprints', () => {
  for (const artifactFingerprint of [
    { status: 'verified', kind: 'source-public-sha256', value: 'a'.repeat(64), references: ['docs/ops/OPERATING_CONTRACT.md'] },
    { status: 'verified', kind: 'oci-digest', value: `sha256:${'a'.repeat(64)}`, references: ['docs/ops/OPERATING_CONTRACT.md'] },
    { status: 'verified', kind: 'image-id-or-digest', value: `sha256:${'b'.repeat(64)}`, references: ['docs/ops/OPERATING_CONTRACT.md'] },
    { status: 'verified', kind: 'source-revision', value: 'c'.repeat(40), references: ['docs/ops/OPERATING_CONTRACT.md'] },
  ]) {
    const value = structuredClone(valid);
    value.services[0].artifactFingerprint = artifactFingerprint;
    assert.equal(validateCatalog(value), value);
  }
});

test('rejects references-only promotion for recipient, recovery, and staging drill proof', () => {
  for (const select of [
    (service) => service.alerts.recipientProof,
    (service) => service.recovery.proof,
    (service) => service.staging.drill,
  ]) {
    const value = structuredClone(valid);
    const proof = select(value.services[0]);
    proof.status = 'verified';
    proof.references = ['docs/ops/OPERATING_CONTRACT.md'];
    proof.outcome = null;
    assert.throws(() => validateCatalog(value), /verified .* proof requires typed outcome evidence/);
  }
});

test('accepts bounded kind-matched outcome evidence for each proof class', () => {
  const cases = [
    [(service) => service.alerts.recipientProof, 'recipient-delivery', 'receipt-2026-09-10T120000Z'],
    [(service) => service.recovery.proof, 'recovery-exercise', 'recovery-run-42'],
    [(service) => service.staging.drill, 'staging-drill', 'staging-run-42'],
  ];
  for (const [select, kind, id] of cases) {
    const value = structuredClone(valid);
    Object.assign(select(value.services[0]), {
      status: 'verified',
      references: ['docs/ops/OPERATING_CONTRACT.md'],
      outcome: {
        kind,
        serviceId: 'live',
        id,
        result: 'succeeded',
        observedAt: '2026-09-10T12:00:00Z',
        reference: 'docs/ops/OPERATING_CONTRACT.md',
        contentSha256: 'd'.repeat(64),
      },
    });
    assert.equal(validateCatalog(value), value);
  }
});

test('binds typed outcome service, reference, and receipt identity across the catalog', () => {
  const proof = (serviceId, id = 'receipt-A', reference = 'docs/proof-A.json') => ({
    status: 'verified',
    references: ['docs/proof-A.json'],
    outcome: {
      kind: 'recipient-delivery', serviceId, id, result: 'succeeded',
      observedAt: '2026-09-10T12:00:00Z', reference, contentSha256: 'd'.repeat(64),
    },
  });

  const control = structuredClone(valid);
  control.services[0].alerts.recipientProof = proof('live');
  assert.equal(validateCatalog(control), control);

  const copiedHomeReceipt = structuredClone(valid);
  copiedHomeReceipt.services[0].id = 'home';
  copiedHomeReceipt.services[0].alerts.recipientProof = proof('home');
  const homeCopy = structuredClone(copiedHomeReceipt.services[0]);
  homeCopy.id = 'home-copy';
  copiedHomeReceipt.services.push(homeCopy);
  assert.throws(() => validateCatalog(copiedHomeReceipt), /home-copy.*outcome service/i);

  const mismatchedReference = structuredClone(valid);
  mismatchedReference.services[0].alerts.recipientProof = proof('live', 'receipt-A', 'docs/proof-B.json');
  assert.throws(() => validateCatalog(mismatchedReference), /outcome reference/i);

  const replayedIdentity = structuredClone(valid);
  replayedIdentity.services[0].alerts.recipientProof = proof('live', 'shared-receipt');
  replayedIdentity.services[0].recovery.proof = {
    ...proof('live', 'shared-receipt'),
    outcome: { ...proof('live', 'shared-receipt').outcome, kind: 'recovery-exercise' },
  };
  assert.throws(() => validateCatalog(replayedIdentity), /outcome identity.*unique/i);

  const crossServiceReplay = structuredClone(valid);
  crossServiceReplay.services[0].alerts.recipientProof = proof('live', 'cross-service-receipt');
  const secondService = structuredClone(valid.services[0]);
  secondService.id = 'home-copy';
  secondService.alerts.recipientProof = proof('home-copy', 'cross-service-receipt');
  crossServiceReplay.services.push(secondService);
  assert.throws(() => validateCatalog(crossServiceReplay), /outcome identity.*unique/i);
});

test('doctor refuses structurally invalid verified evidence before assigning levels', async () => {
  const value = structuredClone(valid);
  value.services[0].alerts.recipientProof = {
    status: 'verified',
    references: ['docs/ops/OPERATING_CONTRACT.md'],
    outcome: null,
  };
  await assert.rejects(
    inspect({ catalog: value, options: offlineOptions }),
    /verified recipient proof requires typed outcome evidence/,
  );
});

test('accepts an honest unresolved catalog for deterministic diagnostics', () => {
  const value = fixture('catalog-unresolved.json');
  assert.equal(validateCatalog(value), value);
});

test('doctor derives warning and error levels from typed evidence, never nonempty prose', async () => {
  const value = validateCatalog(fixture('catalog-unresolved.json'));
  const report = await inspect({ catalog: value, options: offlineOptions });
  const levels = new Map(report.results.map((item) => [item.check, item.level]));

  assert.equal(levels.get('fixture-service.deploy-adapter'), 'warning');
  assert.equal(levels.get('fixture-service.deployed-revision'), 'error');
  assert.equal(levels.get('fixture-service.artifact-fingerprint'), 'error');
  assert.equal(levels.get('fixture-service.alerts.route'), 'warning');
  assert.equal(levels.get('fixture-service.alerts.recipient-proof'), 'error');
  assert.equal(levels.get('fixture-service.recovery.target'), 'warning');
  assert.equal(levels.get('fixture-service.recovery.proof'), 'error');
  assert.equal(levels.get('fixture-service.staging'), 'error');
  assert.equal(levels.get('fixture-service.staging.drill'), 'error');
  assert.equal(levels.get('fixture-service.requirement.fixture-external-access'), 'error');
  assert.ok(report.summary.error >= 7);
  assert.equal(report.results.some((item) => item.check === 'fixture-service.mutation-policy' && item.level === 'ok'), false);
});

test('doctor diagnostics do not expose free-form policy, evidence references, or local paths', async () => {
  const value = validateCatalog(fixture('catalog-unresolved.json'));
  value.services[0].mutationPolicy = 'PRIVATE_POLICY_SENTINEL';
  value.services[0].artifactFingerprint.references = ['https://example.com/PRIVATE_REFERENCE_SENTINEL'];
  value.services[0].localPaths = ['PRIVATE_PATH_SENTINEL'];
  const report = await inspect({ catalog: value, options: offlineOptions });
  const output = JSON.stringify(report);

  assert.doesNotMatch(output, /PRIVATE_POLICY_SENTINEL|PRIVATE_REFERENCE_SENTINEL|PRIVATE_PATH_SENTINEL/);
});

test('central catalog separates Account and Listen without changing their shared repository or lane', () => {
  const value = validateCatalog(catalog());
  const account = value.services.find(({ id }) => id === 'account');
  const listen = value.services.find(({ id }) => id === 'listen');

  assert.ok(account);
  assert.ok(listen);
  assert.equal(value.services.some(({ id }) => id === 'account-listener'), false);
  assert.equal(account.repository.slug, 'AlterMundi/harmonic-beacon-webapp');
  assert.equal(listen.repository.slug, account.repository.slug);
  assert.equal(account.integrationLane.name, 'main');
  assert.equal(account.deliveryLane.name, 'early-birds');
  assert.equal(listen.integrationLane.name, 'main');
  assert.equal(listen.deliveryLane.name, 'early-birds');
  assert.notDeepEqual(account.deployAdapter.references, listen.deployAdapter.references);
});

test('analytics records release delivery drift and unknown current deployment provenance honestly', () => {
  const analytics = validateCatalog(catalog()).services.find(({ id }) => id === 'analytics');
  assert.equal(analytics.integrationLane.name, 'main');
  assert.equal(analytics.deliveryLane.name, 'release');
  assert.deepEqual(analytics.deployedRevision, { status: 'unresolved', value: null });
  assert.equal(analytics.artifactFingerprint.status, 'unresolved');
  assert.deepEqual(analytics.health.endpoints.map(({ url }) => url), [
    'https://live.harmonicbeacon.com/_a/health',
    'https://live.harmonicbeacon.com/_a/ready',
  ]);
});

test('Authority and PMP remain explicit external requirements rather than invented truth', () => {
  const authority = validateCatalog(catalog()).services.find(({ id }) => id === 'commerce-authority');
  assert.deepEqual(authority.owner, { status: 'documented', name: 'SairaAsua' });
  assert.deepEqual(authority.repository, { status: 'external', slug: 'SairaAsua/proyecciones-mito' });
  assert.deepEqual(authority.integrationLane, { status: 'external', name: null });
  assert.deepEqual(authority.deliveryLane, { status: 'external', name: null });
  assert.ok(authority.unresolvedRequirements.some((item) => (
    item.kind === 'repository-access'
    && item.status === 'external'
    && item.reference.endsWith('#issuecomment-5625961149')
  )));
});

test('Home keeps the delivered Pages contract while exposing absent staging and recipient proof', () => {
  const home = validateCatalog(catalog()).services.find(({ id }) => id === 'home');
  assert.deepEqual(home.integrationLane, { status: 'verified', name: 'main' });
  assert.deepEqual(home.deliveryLane, { status: 'verified', name: 'main' });
  assert.deepEqual(home.ciWorkflow, { status: 'verified', path: '.github/workflows/ci.yml' });
  assert.equal(home.deployAdapter.kind, 'github-pages-branch');
  assert.equal(home.artifactFingerprint.status, 'verified');
  assert.equal(home.artifactFingerprint.kind, 'source-public-sha256');
  assert.equal(home.artifactFingerprint.value, 'c05a1be42a700e1dc2fac988a658069e35676770cfe8496ea1997f204fd276c8');
  assert.equal(home.staging.status, 'unavailable');
  assert.equal(home.alerts.recipientProof.status, 'unresolved');
  assert.equal(home.recovery.proof.status, 'unresolved');
});

test('JSON Schema v2 requires the typed operational evidence fields', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'deploy/schemas/platform-services.schema.json'), 'utf8'));
  assert.equal(schema.properties.schemaVersion.const, 2);
  const required = schema.properties.services.items.required;
  for (const field of [
    'owner', 'repository', 'integrationLane', 'deliveryLane', 'ciWorkflow', 'deployAdapter',
    'deployedRevision', 'artifactFingerprint', 'health', 'alerts', 'recovery', 'staging',
    'unresolvedRequirements',
  ]) assert.ok(required.includes(field), `${field} is required`);
  assert.deepEqual(schema.$defs.evidenceStatus.enum, ['verified', 'documented', 'unresolved', 'external', 'unavailable', 'not-applicable']);
  assert.ok(schema.$defs.artifactFingerprint.required.includes('value'));
  assert.ok(schema.$defs.proof.required.includes('outcome'));
  assert.deepEqual(schema.$defs.outcomeEvidence.required, [
    'kind', 'serviceId', 'id', 'result', 'observedAt', 'reference', 'contentSha256',
  ]);
  for (const definition of ['owner', 'repository', 'lane', 'ciWorkflow', 'deployAdapter', 'deployedRevision', 'artifactFingerprint', 'health', 'alertRoute', 'proof', 'recoveryTarget', 'staging']) {
    assert.ok(schema.$defs[definition].allOf, `${definition} must bind verified status to evidence`);
  }
});

test('canonical docs supersede prose-based catalog interpretation without claiming delivery or recovery proof', () => {
  const docs = readFileSync(resolve(REPO_ROOT, 'docs/ops/OPERATING_CONTRACT.md'), 'utf8');
  assert.match(docs, /schema version 2 supersedes every schema version 1 catalog interpretation/i);
  assert.match(docs, /catalog truth only; it is not delivery, alert-recipient, staging-drill, or recovery proof/i);
  assert.match(docs, /References or prose alone cannot establish verified proof/i);
  assert.match(docs, /Account and Listen remain separate services/i);
});

test('reports a nonexistent current-checkout path as an error', () => {
  const service = structuredClone(valid.services[0]);
  service.localPaths.push('does/not/exist');
  const results = inspectLocalRoutes(service, (path) => path !== 'does/not/exist');
  assert.deepEqual(results.find(({ detail }) => detail === 'does/not/exist'), {
    level: 'error',
    check: 'live.file',
    detail: 'does/not/exist',
  });
});

test('GitHub Contents treats branch-qualified files and directories as existing', () => {
  assert.equal(githubContentsExist({ sha: 'abc123' }), true);
  assert.equal(githubContentsExist([{ name: 'child' }]), true);
  assert.equal(githubContentsExist([]), true);
  assert.equal(githubContentsExist(null), false);
});

test('reports a missing branch-qualified path as an error', async () => {
  const service = structuredClone(valid.services[0]);
  const source = {
    ref: 'early-birds',
    paths: ['src/app/account'],
    workflows: ['.github/workflows/early-birds-fast-forward.yml'],
    recoveryDocs: [],
  };
  const results = await inspectBranchSource(service, source, async (path) => path !== 'src/app/account');
  assert.deepEqual(results.find(({ detail }) => detail.includes('src/app/account')), {
    level: 'error',
    check: 'live.branch-file',
    detail: 'early-birds:src/app/account',
  });
});

test('requires meaningful current-push review and exact Actions App delivery context', () => {
  const policy = {
    protectedBranches: ['main', 'release'],
    requiredContext: 'delivery-gate',
    requiredAppId: 15368,
    requirePullRequest: true,
    requireCodeOwnerReviews: true,
    requiredApprovingReviewCount: 1,
    dismissStaleReviews: true,
    requireLastPushApproval: true,
    requireUpToDate: true,
    allowForcePushes: false,
    allowDeletions: false,
  };
  const protection = (overrides = {}) => ({
    required_status_checks: {
      strict: true,
      contexts: [],
      checks: [{ context: 'delivery-gate', app_id: 15368 }],
      ...overrides.required_status_checks,
    },
    required_pull_request_reviews: {
      require_code_owner_reviews: true,
      required_approving_review_count: 1,
      dismiss_stale_reviews: true,
      require_last_push_approval: true,
      ...overrides.required_pull_request_reviews,
    },
    allow_force_pushes: overrides.allow_force_pushes ?? { enabled: false },
    allow_deletions: overrides.allow_deletions ?? { enabled: false },
  });

  assert.equal(evaluateDeliveryProtection(policy, 'main', null).ok, false);
  assert.match(evaluateDeliveryProtection(policy, 'main', protection({
    required_status_checks: { checks: [{ context: 'delivery-gate', app_id: -1 }] },
  })).detail, /exact Actions App 15368/);
  assert.match(evaluateDeliveryProtection(policy, 'main', protection({
    required_pull_request_reviews: { required_approving_review_count: 0 },
  })).detail, /at least 1 approving review/);
  assert.match(evaluateDeliveryProtection(policy, 'main', protection({
    required_pull_request_reviews: { dismiss_stale_reviews: false },
  })).detail, /stale reviews are not dismissed/);
  assert.match(evaluateDeliveryProtection(policy, 'main', protection({
    required_pull_request_reviews: { require_last_push_approval: false },
  })).detail, /last push approval is not required/);
  assert.match(evaluateDeliveryProtection(policy, 'main', protection({
    required_pull_request_reviews: { require_code_owner_reviews: false },
  })).detail, /code-owner review is not required/);
  assert.match(evaluateDeliveryProtection(policy, 'main', protection({
    required_status_checks: { strict: false },
  })).detail, /up-to-date head/);
  assert.match(evaluateDeliveryProtection(policy, 'main', protection({
    allow_force_pushes: { enabled: true },
  })).detail, /force pushes are enabled/);
  assert.match(evaluateDeliveryProtection(policy, 'main', protection({
    allow_deletions: { enabled: true },
  })).detail, /branch deletion is enabled/);
  assert.deepEqual(evaluateDeliveryProtection(policy, 'main', protection()), {
    ok: true,
    detail: 'main: protected with 1 current-push/code-owner approval, stale dismissal, strict base, no force pushes/deletion and delivery-gate from Actions App 15368',
  });
});

test('catalog delivery policy requires review freshness and exact check App binding', () => {
  const value = structuredClone(valid);
  value.services[0].deliveryPolicy = {
    protectedBranches: ['main'],
    requiredContext: 'delivery-gate',
    requiredAppId: 15368,
    requirePullRequest: true,
    requireCodeOwnerReviews: true,
    requiredApprovingReviewCount: 1,
    dismissStaleReviews: true,
    requireLastPushApproval: true,
    requireUpToDate: true,
    allowForcePushes: false,
    allowDeletions: false,
  };
  assert.equal(validateCatalog(value), value);
  assert.deepEqual(schemaValidity([value]), [true]);
  for (const field of ['requiredAppId', 'requiredApprovingReviewCount', 'dismissStaleReviews', 'requireLastPushApproval']) {
    const invalid = structuredClone(value);
    delete invalid.services[0].deliveryPolicy[field];
    assert.throws(() => validateCatalog(invalid), /invalid delivery policy/, field);
    assert.deepEqual(schemaValidity([invalid]), [false], field);
  }
});

test('catalog branch routes remain mechanically verifiable and reject empty routing', () => {
  const value = structuredClone(valid);
  value.services[0].workflows = [];
  assert.throws(() => validateCatalog(value), /delivery or recovery route/);

  const branchQualified = structuredClone(value);
  branchQualified.services[0].branchSources = [{
    ref: 'early-birds',
    paths: ['src/app/account'],
    workflows: ['.github/workflows/early-birds-fast-forward.yml'],
    recoveryDocs: [],
  }];
  assert.equal(validateCatalog(branchQualified), branchQualified);
  assert.deepEqual(schemaValidity([branchQualified]), [true]);
});
