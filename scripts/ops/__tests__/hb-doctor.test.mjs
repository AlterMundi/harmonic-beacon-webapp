import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateDeliveryProtection,
  githubContentsExist,
  inspectBranchSource,
  inspectLocalRoutes,
  validateCatalog,
} from '../hb-doctor.mjs';

const valid = {
  schemaVersion: 1,
  services: [{
    id: 'live',
    name: 'Live',
    repository: 'AlterMundi/harmonic-beacon-webapp',
    authority: { status: 'confirmed', detail: 'webapp repository and Live lanes' },
    lanes: ['main'],
    localPaths: ['src'],
    workflows: ['.github/workflows/ci.yml'],
    branchSources: [],
    health: [{ name: 'ready', url: 'https://example.com/ready', expectStatus: [200] }],
    recoveryDocs: [],
    alerts: 'alerts',
    runner: 'runner',
    mutation: 'workflow only',
  }],
};

test('accepts the lane-aware versioned catalog contract', () => {
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

test('rejects services without a verifiable workflow or fail-closed recovery route', () => {
  const catalog = structuredClone(valid);
  catalog.services[0].workflows = [];
  assert.throws(() => validateCatalog(catalog), /delivery or recovery route/);
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

test('requires protected branches, PR review, no force pushes and the exact aggregate context', () => {
  const policy = {
    protectedBranches: ['main', 'release'],
    requiredContext: 'delivery-gate',
    requirePullRequest: true,
    requireCodeOwnerReviews: true,
    requireUpToDate: true,
    allowForcePushes: false,
    allowDeletions: false,
  };
  assert.deepEqual(evaluateDeliveryProtection(policy, 'main', null), {
    ok: false,
    detail: 'main: branch protection unavailable',
  });
  assert.deepEqual(evaluateDeliveryProtection(policy, 'main', {
    required_status_checks: { strict: true, contexts: ['test'], checks: [] },
    required_pull_request_reviews: { require_code_owner_reviews: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  }), {
    ok: false,
    detail: 'main: missing required context delivery-gate',
  });
  assert.deepEqual(evaluateDeliveryProtection(policy, 'main', {
    required_status_checks: { strict: true, contexts: ['delivery-gate'], checks: [] },
    required_pull_request_reviews: null,
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  }), {
    ok: false,
    detail: 'main: pull requests are not required',
  });
  assert.deepEqual(evaluateDeliveryProtection(policy, 'main', {
    required_status_checks: { strict: true, contexts: ['delivery-gate'], checks: [] },
    required_pull_request_reviews: { require_code_owner_reviews: true },
    allow_force_pushes: { enabled: true },
    allow_deletions: { enabled: false },
  }), {
    ok: false,
    detail: 'main: force pushes are enabled',
  });
  assert.deepEqual(evaluateDeliveryProtection(policy, 'main', {
    required_status_checks: { strict: true, contexts: ['delivery-gate'], checks: [] },
    required_pull_request_reviews: { require_code_owner_reviews: false },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  }), {
    ok: false,
    detail: 'main: code-owner review is not required',
  });
  assert.deepEqual(evaluateDeliveryProtection(policy, 'main', {
    required_status_checks: { strict: true, contexts: ['delivery-gate'], checks: [] },
    required_pull_request_reviews: { require_code_owner_reviews: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: true },
  }), {
    ok: false,
    detail: 'main: branch deletion is enabled',
  });
  assert.deepEqual(evaluateDeliveryProtection(policy, 'main', {
    required_status_checks: { strict: false, contexts: ['delivery-gate'], checks: [] },
    required_pull_request_reviews: { require_code_owner_reviews: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  }), {
    ok: false,
    detail: 'main: base updates do not require an up-to-date head',
  });
  assert.deepEqual(evaluateDeliveryProtection(policy, 'main', {
    required_status_checks: { strict: true, contexts: ['delivery-gate'], checks: [] },
    required_pull_request_reviews: { require_code_owner_reviews: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  }), {
    ok: true,
    detail: 'main: protected with PR/code-owner review, strict base, no force pushes/deletion and delivery-gate',
  });
});

test('preserves unresolved owner authority as an explicit warning contract', () => {
  const catalog = structuredClone(valid);
  catalog.services[0].authority = { status: 'unresolved', detail: 'owner workflow not verified' };
  assert.equal(validateCatalog(catalog), catalog);
  assert.equal(catalog.services[0].authority.status, 'unresolved');
});
