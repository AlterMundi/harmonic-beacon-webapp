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
  const catalog = structuredClone(valid);
  catalog.services[0].deliveryPolicy = {
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
  assert.equal(validateCatalog(catalog), catalog);
  for (const field of ['requiredAppId', 'requiredApprovingReviewCount', 'dismissStaleReviews', 'requireLastPushApproval']) {
    const invalid = structuredClone(catalog);
    delete invalid.services[0].deliveryPolicy[field];
    assert.throws(() => validateCatalog(invalid), /invalid delivery policy/, field);
  }
});

test('preserves unresolved owner authority as an explicit warning contract', () => {
  const catalog = structuredClone(valid);
  catalog.services[0].authority = { status: 'unresolved', detail: 'owner workflow not verified' };
  assert.equal(validateCatalog(catalog), catalog);
  assert.equal(catalog.services[0].authority.status, 'unresolved');
});
