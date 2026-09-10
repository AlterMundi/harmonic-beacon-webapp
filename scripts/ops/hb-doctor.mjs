#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_CATALOG = resolve(REPO_ROOT, 'deploy/platform-services.json');
export const CATALOG_LIMITS = Object.freeze({
  catalogBytes: 1_048_576,
  services: 64,
  endpointsPerService: 32,
  environmentsPerService: 32,
  requirementsPerService: 32,
  aggregateChecks: 1_024,
  reportEntries: 2_048,
});
const LEVEL_ORDER = { ok: 0, skipped: 0, warning: 1, error: 2 };
const EVIDENCE_LEVEL = {
  verified: 'ok',
  documented: 'warning',
  unresolved: 'error',
  external: 'error',
  unavailable: 'error',
  'not-applicable': 'skipped',
};
const REQUIREMENT_KINDS = new Set([
  'repository-access',
  'repository-identification',
  'workflow-authorization',
  'deploy-adapter',
  'deployment-revision',
  'artifact-fingerprint',
  'alert-route',
  'recipient-proof',
  'recovery-proof',
  'staging-environment',
  'staging-drill',
]);
const REQUIREMENT_BLOCKS = new Set(['catalog-readback', 'delivery-proof', 'alert-proof', 'recovery-proof', 'staging-proof']);
const DEPLOY_ADAPTER_KINDS = new Set(['github-pages-branch', 'github-actions-workflow', 'repository-script', 'compose-systemd', 'unknown']);
const ARTIFACT_KINDS = new Set(['source-public-sha256', 'oci-digest', 'image-id-or-digest', 'source-revision', 'unknown']);
const ALERT_ROUTE_KINDS = new Set(['hosting-provider', 'service-monitor', 'alertmanager', 'unknown']);
const RECOVERY_TARGET_KINDS = new Set(['prior-git-revision', 'prior-artifact', 'restore-and-roll-forward', 'forward-repair', 'unknown']);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OCI_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SOURCE_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const OUTCOME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12]\d|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-9]))T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/;
const UNSAFE_STRING_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const UNSAFE_STRING_GLOBAL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const IPV4_OCTET_SOURCE = '(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])';
const DNS_LABEL_SOURCE = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HTTPS_HOST_SOURCE = `(?:(?:${IPV4_OCTET_SOURCE}\\.){3}${IPV4_OCTET_SOURCE}|(?=[a-z0-9.-]*[a-z])${DNS_LABEL_SOURCE}(?:\\.${DNS_LABEL_SOURCE})*)`;
const STRICT_URL_PREFIX_SOURCE = '^(?!.*\\\\)(?!.*%(?![0-9A-F]{2}))(?!.*%(?:0[0-9A-F]|1[0-9A-F]|7F|8[0-9A-F]|9[0-9A-F]|2E|2F|5C|23|3F))(?!.*\\/\\.\\.?(?:\\/|[?#]|$))https:\\/\\/';
const STRICT_URL_TAIL_SOURCE = '(?:\\/[^\\s\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\\\#]*)?(?:\\?[^\\s\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\\\#]*)?';
export const STRICT_HTTPS_URL_PATTERN_SOURCE = `${STRICT_URL_PREFIX_SOURCE}${HTTPS_HOST_SOURCE}${STRICT_URL_TAIL_SOURCE}$`;
export const STRICT_HTTPS_REFERENCE_PATTERN_SOURCE = `${STRICT_URL_PREFIX_SOURCE}${HTTPS_HOST_SOURCE}${STRICT_URL_TAIL_SOURCE}(?:#[^\\s\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\\\]*)?$`;
const HTTPS_URL_PATTERN = new RegExp(STRICT_HTTPS_URL_PATTERN_SOURCE, 'u');
const HTTPS_REFERENCE_PATTERN = new RegExp(STRICT_HTTPS_REFERENCE_PATTERN_SOURCE, 'u');
const GENERIC_CATALOG_ERROR = 'hb doctor: catalog could not be read or validated';

function sanitizeText(value, maxLength) {
  const text = String(value ?? '').replace(UNSAFE_STRING_GLOBAL_PATTERN, '?');
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function result(level, check, detail, extra = {}) {
  return {
    ...extra,
    level,
    check: sanitizeText(check, 160),
    detail: sanitizeText(detail, 320),
  };
}

export function inspectLocalRoutes(service, pathExists = (path) => existsSync(resolve(REPO_ROOT, path))) {
  return [...service.localPaths, ...(service.workflows ?? []), ...(service.recoveryDocs ?? [])].map((path) =>
    result(pathExists(path) ? 'ok' : 'error', `${service.id}.file`, path));
}

export async function inspectBranchSource(service, source, pathExists) {
  const paths = [...source.paths, ...source.workflows, ...source.recoveryDocs];
  const results = [];
  for (const path of paths) {
    const exists = await pathExists(path, source.ref);
    results.push(result(exists ? 'ok' : 'error', `${service.id}.branch-file`, `${source.ref}:${path}`));
  }
  return results;
}

export function evaluateDeliveryProtection(policy, branch, protection) {
  if (!protection) return { ok: false, detail: `${branch}: branch protection unavailable` };
  const exactCheck = (protection.required_status_checks?.checks ?? []).find(
    ({ context, app_id: appId }) => context === policy.requiredContext && appId === policy.requiredAppId,
  );
  if (!exactCheck) {
    return { ok: false, detail: `${branch}: ${policy.requiredContext} is not bound to exact Actions App ${policy.requiredAppId}` };
  }
  const reviews = protection.required_pull_request_reviews;
  if (policy.requirePullRequest && !reviews) {
    return { ok: false, detail: `${branch}: pull requests are not required` };
  }
  if (policy.allowForcePushes === false && protection.allow_force_pushes?.enabled !== false) {
    return { ok: false, detail: `${branch}: force pushes are enabled` };
  }
  if (policy.requireCodeOwnerReviews && reviews?.require_code_owner_reviews !== true) {
    return { ok: false, detail: `${branch}: code-owner review is not required` };
  }
  if ((reviews?.required_approving_review_count ?? 0) < policy.requiredApprovingReviewCount) {
    return { ok: false, detail: `${branch}: branch does not require at least ${policy.requiredApprovingReviewCount} approving review(s)` };
  }
  if (policy.dismissStaleReviews && reviews?.dismiss_stale_reviews !== true) {
    return { ok: false, detail: `${branch}: stale reviews are not dismissed` };
  }
  if (policy.requireLastPushApproval && reviews?.require_last_push_approval !== true) {
    return { ok: false, detail: `${branch}: last push approval is not required` };
  }
  if (policy.allowDeletions === false && protection.allow_deletions?.enabled !== false) {
    return { ok: false, detail: `${branch}: branch deletion is enabled` };
  }
  if (policy.requireUpToDate && protection.required_status_checks?.strict !== true) {
    return { ok: false, detail: `${branch}: base updates do not require an up-to-date head` };
  }
  return {
    ok: true,
    detail: `${branch}: protected with ${policy.requiredApprovingReviewCount} current-push/code-owner approval, stale dismissal, strict base, no force pushes/deletion and ${policy.requiredContext} from Actions App ${policy.requiredAppId}`,
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSafeStrings(value, label = 'catalog') {
  if (typeof value === 'string') {
    if (UNSAFE_STRING_PATTERN.test(value)) throw new Error(`${label} contains prohibited control characters`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeStrings(item, `${label}[${index}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (UNSAFE_STRING_PATTERN.test(key)) throw new Error(`${label} contains a prohibited key`);
      assertSafeStrings(item, `${label}.${key}`);
    }
  }
}

function structuralKey(value) {
  if (Array.isArray(value)) return `[${value.map(structuralKey).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${structuralKey(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hasUniqueItems(items) {
  return new Set(items.map(structuralKey)).size === items.length;
}

function assertUniqueItems(serviceId, label, items) {
  if (!hasUniqueItems(items)) throw new Error(`${serviceId}.${label} must contain unique items`);
}

function isHttpsUrl(value, { allowFragment = true } = {}) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  const syntax = allowFragment ? HTTPS_REFERENCE_PATTERN : HTTPS_URL_PATTERN;
  if (!syntax.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.hostname.length > 0
      && parsed.username === ''
      && parsed.password === ''
      && parsed.port === ''
      && (allowFragment || parsed.hash === '');
  } catch {
    return false;
  }
}

function assertStatus(serviceId, label, value) {
  if (!isObject(value) || !Object.hasOwn(EVIDENCE_LEVEL, value.status)) {
    throw new Error(`${serviceId} has an invalid ${label} status`);
  }
}

function assertKnownValue(serviceId, label, evidence, key) {
  if (['verified', 'documented'].includes(evidence.status) && evidence[key] === null) {
    throw new Error(`${serviceId} ${evidence.status} ${label} requires ${key}`);
  }
}

function assertVerifiedItems(serviceId, label, evidence, key) {
  if (evidence.status === 'verified' && evidence[key].length === 0) {
    throw new Error(`${serviceId} verified ${label} requires ${key}`);
  }
}

function assertVerifiedKindEvidence(serviceId, label, evidence) {
  if (evidence.status !== 'verified') return;
  const hasValue = typeof evidence.value === 'string' && evidence.value.length > 0;
  const hasEvidence = Array.isArray(evidence.references) && evidence.references.length > 0;
  if (evidence.kind === 'unknown' || (!hasValue && !hasEvidence)) {
    throw new Error(`${serviceId} verified ${label} requires a concrete kind-compatible value or evidence`);
  }
}

function isRepositoryPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.split('/').includes('..')
    && /^[A-Za-z0-9._@/-]+$/.test(value);
}

function assertRepositoryPath(serviceId, label, value) {
  if (!isRepositoryPath(value)) throw new Error(`${serviceId}.${label} must be repository-relative`);
}

function assertReferences(serviceId, label, references) {
  if (!Array.isArray(references) || references.length > 16) throw new Error(`${serviceId}.${label} must contain at most 16 references`);
  assertUniqueItems(serviceId, label, references);
  for (const reference of references) {
    if (!(isHttpsUrl(reference) || isRepositoryPath(reference))) {
      throw new Error(`${serviceId}.${label} has an invalid reference`);
    }
  }
}

function assertArtifactFingerprint(serviceId, evidence) {
  const patterns = {
    'source-public-sha256': SHA256_PATTERN,
    'oci-digest': OCI_DIGEST_PATTERN,
    'image-id-or-digest': OCI_DIGEST_PATTERN,
    'source-revision': SOURCE_REVISION_PATTERN,
  };
  if (evidence.status === 'verified' && (evidence.kind === 'unknown' || typeof evidence.value !== 'string')) {
    throw new Error(`${serviceId} verified artifact fingerprint requires a concrete value`);
  }
  if (evidence.value !== undefined && evidence.value !== null) {
    if (typeof evidence.value !== 'string' || !patterns[evidence.kind]?.test(evidence.value)) {
      throw new Error(`${serviceId} artifact fingerprint value is incompatible with kind`);
    }
  } else if (evidence.status === 'verified') {
    throw new Error(`${serviceId} verified artifact fingerprint requires a concrete value`);
  }
}

function assertOutcomeProof(serviceId, label, proof, expectedKind, outcomeIds) {
  const outcome = proof.outcome;
  if (outcome === null && proof.status !== 'verified') return;
  if (!isObject(outcome)) {
    throw new Error(`${serviceId} verified ${label} proof requires typed outcome evidence`);
  }
  requireKeys(serviceId, `${label} outcome`, outcome, ['kind', 'serviceId', 'id', 'result', 'observedAt', 'reference', 'contentSha256']);
  if (!['recipient-delivery', 'recovery-exercise', 'staging-drill'].includes(outcome.kind)) {
    throw new Error(`${serviceId} ${label} proof has an invalid outcome kind`);
  }
  if (proof.status === 'verified' && outcome.kind !== expectedKind) {
    throw new Error(`${serviceId} verified ${label} proof requires typed outcome evidence`);
  }
  if (outcome.serviceId !== serviceId) {
    throw new Error(`${serviceId} ${label} outcome service must match its enclosing service`);
  }
  if (!proof.references.includes(outcome.reference)) {
    throw new Error(`${serviceId} ${label} outcome reference must equal a proof reference`);
  }
  const validTime = typeof outcome.observedAt === 'string'
    && UTC_TIMESTAMP_PATTERN.test(outcome.observedAt)
    && !Number.isNaN(Date.parse(outcome.observedAt));
  const validReference = isHttpsUrl(outcome.reference) || isRepositoryPath(outcome.reference);
  if (!OUTCOME_ID_PATTERN.test(outcome.id ?? '')
      || outcome.result !== 'succeeded'
      || !validTime
      || !validReference
      || !SHA256_PATTERN.test(outcome.contentSha256 ?? '')) {
    throw new Error(`${serviceId} verified ${label} proof requires typed outcome evidence`);
  }
  if (outcomeIds.has(outcome.id)) throw new Error('catalog outcome identity must be unique');
  outcomeIds.add(outcome.id);
}

function requireKeys(serviceId, label, value, required, optional = []) {
  if (!isObject(value) || required.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${serviceId} has an invalid ${label} contract`);
  }
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${serviceId} has unknown ${label} fields`);
  }
}

export function validateCatalog(catalog) {
  const serialized = JSON.stringify(catalog);
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > CATALOG_LIMITS.catalogBytes) {
    throw new Error(`catalog must contain at most ${CATALOG_LIMITS.catalogBytes} bytes`);
  }
  assertSafeStrings(catalog);
  requireKeys('catalog', 'root', catalog, ['schemaVersion', 'services'], ['$schema']);
  if (catalog.schemaVersion !== 2 || !Array.isArray(catalog.services) || catalog.services.length === 0) {
    throw new Error('platform service catalog must use schemaVersion 2 and contain services');
  }
  if (catalog.services.length > CATALOG_LIMITS.services) {
    throw new Error(`catalog must contain at most ${CATALOG_LIMITS.services} services`);
  }
  if (Object.hasOwn(catalog, '$schema') && typeof catalog.$schema !== 'string') {
    throw new Error('catalog.$schema must be a string');
  }
  const seen = new Set();
  const outcomeIds = new Set();
  let aggregateChecks = 0;
  for (const service of catalog.services) {
    const required = [
      'id', 'name', 'owner', 'repository', 'integrationLane', 'deliveryLane', 'ciWorkflow',
      'deployAdapter', 'localPaths', 'deployedRevision', 'artifactFingerprint', 'health',
      'alerts', 'recovery', 'staging',
      'unresolvedRequirements', 'mutationPolicy',
    ];
    requireKeys(service?.id ?? 'service', 'service', service, required, [
      'runnerVerification', 'deliveryPolicy', 'workflows', 'branchSources', 'recoveryDocs',
    ]);
    if (typeof service.name !== 'string' || service.name.length === 0) {
      throw new Error(`${service.id ?? 'service'} has an invalid name`);
    }
    if (!/^[a-z0-9-]+$/.test(service.id) || seen.has(service.id)) {
      throw new Error(`invalid or duplicate service id: ${service.id}`);
    }
    seen.add(service.id);

    for (const [label, evidence] of [
      ['owner', service.owner],
      ['repository', service.repository],
      ['integrationLane', service.integrationLane],
      ['deliveryLane', service.deliveryLane],
      ['ciWorkflow', service.ciWorkflow],
      ['deployAdapter', service.deployAdapter],
      ['deployedRevision', service.deployedRevision],
      ['artifactFingerprint', service.artifactFingerprint],
      ['health', service.health],
      ['alerts.route', service.alerts?.route],
      ['alerts.recipientProof', service.alerts?.recipientProof],
      ['recovery.target', service.recovery?.target],
      ['recovery.proof', service.recovery?.proof],
      ['staging', service.staging],
      ['staging.drill', service.staging?.drill],
    ]) assertStatus(service.id, label, evidence);

    requireKeys(service.id, 'owner', service.owner, ['status', 'name']);
    requireKeys(service.id, 'repository', service.repository, ['status', 'slug']);
    requireKeys(service.id, 'integration lane', service.integrationLane, ['status', 'name']);
    requireKeys(service.id, 'delivery lane', service.deliveryLane, ['status', 'name']);
    requireKeys(service.id, 'CI workflow', service.ciWorkflow, ['status', 'path']);
    requireKeys(service.id, 'deploy adapter', service.deployAdapter, ['status', 'kind', 'references']);
    requireKeys(service.id, 'deployed revision', service.deployedRevision, ['status', 'value']);
    requireKeys(service.id, 'artifact fingerprint', service.artifactFingerprint, ['status', 'kind', 'value', 'references']);
    requireKeys(service.id, 'health', service.health, ['status', 'endpoints']);
    requireKeys(service.id, 'alerts', service.alerts, ['route', 'recipientProof']);
    requireKeys(service.id, 'alert route', service.alerts.route, ['status', 'kind', 'references']);
    requireKeys(service.id, 'alert recipient proof', service.alerts.recipientProof, ['status', 'references', 'outcome']);
    requireKeys(service.id, 'recovery', service.recovery, ['target', 'proof']);
    requireKeys(service.id, 'recovery target', service.recovery.target, ['status', 'kind', 'references']);
    requireKeys(service.id, 'recovery proof', service.recovery.proof, ['status', 'references', 'outcome']);
    requireKeys(service.id, 'staging', service.staging, ['status', 'environments', 'drill']);
    requireKeys(service.id, 'staging drill', service.staging.drill, ['status', 'references', 'outcome']);

    if (service.owner.name !== null && !(typeof service.owner.name === 'string' && service.owner.name.length > 0)) {
      throw new Error(`${service.id}.owner.name must be a nonempty string or null`);
    }
    if (service.repository.slug !== null && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(service.repository.slug)) {
      throw new Error(`${service.id}.repository.slug is invalid`);
    }
    for (const [label, lane] of [['integrationLane', service.integrationLane], ['deliveryLane', service.deliveryLane]]) {
      if (lane.name !== null && !/^[A-Za-z0-9._/-]+$/.test(lane.name)) throw new Error(`${service.id}.${label}.name is invalid`);
    }
    assertKnownValue(service.id, 'owner', service.owner, 'name');
    assertKnownValue(service.id, 'repository', service.repository, 'slug');
    assertKnownValue(service.id, 'integrationLane', service.integrationLane, 'name');
    assertKnownValue(service.id, 'deliveryLane', service.deliveryLane, 'name');
    assertKnownValue(service.id, 'ciWorkflow', service.ciWorkflow, 'path');
    if (service.ciWorkflow.path !== null) assertRepositoryPath(service.id, 'ciWorkflow.path', service.ciWorkflow.path);
    if (!Array.isArray(service.localPaths)) throw new Error(`${service.id}.localPaths must be an array`);
    assertUniqueItems(service.id, 'localPaths', service.localPaths);
    for (const path of service.localPaths) assertRepositoryPath(service.id, 'localPaths', path);
    const hasRouteContract = ['workflows', 'branchSources', 'recoveryDocs']
      .some((key) => Object.hasOwn(service, key));
    for (const key of ['workflows', 'branchSources', 'recoveryDocs']) {
      if (Object.hasOwn(service, key) && !Array.isArray(service[key])) throw new Error(`${service.id}.${key} must be an array`);
      assertUniqueItems(service.id, key, service[key] ?? []);
    }
    for (const key of ['workflows', 'recoveryDocs']) {
      for (const path of service[key] ?? []) assertRepositoryPath(service.id, key, path);
    }
    for (const source of service.branchSources ?? []) {
      requireKeys(service.id, 'branch source', source, ['ref', 'paths', 'workflows', 'recoveryDocs']);
      if (typeof source.ref !== 'string' || !source.ref || source.ref.startsWith('refs/pull/')
          || !/^[A-Za-z0-9._/-]+$/.test(source.ref)) {
        throw new Error(`${service.id} has an invalid branch source ref`);
      }
      for (const key of ['paths', 'workflows', 'recoveryDocs']) {
        if (!Array.isArray(source[key])) throw new Error(`${service.id} branch source ${source.ref}.${key} must be an array`);
        assertUniqueItems(service.id, `branch source ${source.ref}.${key}`, source[key]);
        for (const path of source[key]) assertRepositoryPath(service.id, `branch source ${source.ref}.${key}`, path);
      }
    }
    const hasRoute = (service.workflows?.length ?? 0) > 0
      || (service.recoveryDocs?.length ?? 0) > 0
      || (service.branchSources ?? []).some((source) => source.workflows.length > 0 || source.recoveryDocs.length > 0);
    if (hasRouteContract && !hasRoute) throw new Error(`${service.id} has no mechanically verifiable delivery or recovery route`);
    if (Object.hasOwn(service, 'deliveryPolicy')) {
      const policy = service.deliveryPolicy;
      requireKeys(service.id, 'delivery policy', policy, [
        'protectedBranches', 'requiredContext', 'requiredAppId', 'requirePullRequest',
        'requireCodeOwnerReviews', 'requiredApprovingReviewCount', 'dismissStaleReviews',
        'requireLastPushApproval', 'requireUpToDate', 'allowForcePushes', 'allowDeletions',
      ]);
      if (!Array.isArray(policy.protectedBranches)
          || policy.protectedBranches.length === 0
          || !hasUniqueItems(policy.protectedBranches)
          || policy.protectedBranches.some((branch) => typeof branch !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(branch))
          || typeof policy.requiredContext !== 'string'
          || !policy.requiredContext
          || !Number.isSafeInteger(policy.requiredAppId)
          || policy.requiredAppId <= 0
          || policy.requirePullRequest !== true
          || policy.requireCodeOwnerReviews !== true
          || !Number.isSafeInteger(policy.requiredApprovingReviewCount)
          || policy.requiredApprovingReviewCount <= 0
          || policy.dismissStaleReviews !== true
          || policy.requireLastPushApproval !== true
          || policy.requireUpToDate !== true
          || policy.allowForcePushes !== false
          || policy.allowDeletions !== false) {
        throw new Error(`${service.id} has an invalid delivery policy`);
      }
    }
    if (service.deployedRevision.value !== null && !/^[0-9a-f]{40}$/.test(service.deployedRevision.value)) {
      throw new Error(`${service.id}.deployedRevision.value must be a full commit SHA or null`);
    }
    if (service.deployedRevision.status === 'verified' && service.deployedRevision.value === null) {
      throw new Error(`${service.id} verified deployedRevision requires value`);
    }
    if (!DEPLOY_ADAPTER_KINDS.has(service.deployAdapter.kind)) throw new Error(`${service.id}.deployAdapter.kind is invalid`);
    if (!ARTIFACT_KINDS.has(service.artifactFingerprint.kind)) throw new Error(`${service.id}.artifactFingerprint.kind is invalid`);
    if (!ALERT_ROUTE_KINDS.has(service.alerts.route.kind)) throw new Error(`${service.id}.alerts.route.kind is invalid`);
    if (!RECOVERY_TARGET_KINDS.has(service.recovery.target.kind)) throw new Error(`${service.id}.recovery.target.kind is invalid`);
    for (const [label, evidence] of [
      ['deploy adapter', service.deployAdapter],
      ['artifact fingerprint', service.artifactFingerprint],
      ['alert route', service.alerts.route],
      ['recovery target', service.recovery.target],
    ]) assertVerifiedKindEvidence(service.id, label, evidence);

    assertReferences(service.id, 'deployAdapter.references', service.deployAdapter.references);
    assertReferences(service.id, 'artifactFingerprint.references', service.artifactFingerprint.references);
    assertArtifactFingerprint(service.id, service.artifactFingerprint);
    assertReferences(service.id, 'alerts.route.references', service.alerts.route.references);
    assertReferences(service.id, 'alerts.recipientProof.references', service.alerts.recipientProof.references);
    assertReferences(service.id, 'recovery.target.references', service.recovery.target.references);
    assertReferences(service.id, 'recovery.proof.references', service.recovery.proof.references);
    assertReferences(service.id, 'staging.drill.references', service.staging.drill.references);
    assertOutcomeProof(service.id, 'recipient', service.alerts.recipientProof, 'recipient-delivery', outcomeIds);
    assertOutcomeProof(service.id, 'recovery', service.recovery.proof, 'recovery-exercise', outcomeIds);
    assertOutcomeProof(service.id, 'staging drill', service.staging.drill, 'staging-drill', outcomeIds);
    for (const [label, evidence] of [
      ['deployAdapter', service.deployAdapter],
      ['artifactFingerprint', service.artifactFingerprint],
      ['alerts.route', service.alerts.route],
      ['alerts.recipientProof', service.alerts.recipientProof],
      ['recovery.target', service.recovery.target],
      ['recovery.proof', service.recovery.proof],
      ['staging.drill', service.staging.drill],
    ]) assertVerifiedItems(service.id, label, evidence, 'references');

    if (!Array.isArray(service.health.endpoints)) throw new Error(`${service.id}.health.endpoints must be an array`);
    if (service.health.endpoints.length > CATALOG_LIMITS.endpointsPerService) {
      throw new Error(`${service.id} must contain at most ${CATALOG_LIMITS.endpointsPerService} endpoints`);
    }
    aggregateChecks += service.health.endpoints.length;
    assertVerifiedItems(service.id, 'health', service.health, 'endpoints');
    assertUniqueItems(service.id, 'health.endpoints', service.health.endpoints);
    for (const endpoint of service.health.endpoints) {
      requireKeys(service.id, 'health endpoint', endpoint, ['name', 'url', 'expectStatus'], ['provenanceField']);
      const statusesValid = Array.isArray(endpoint.expectStatus)
        && endpoint.expectStatus.length > 0
        && hasUniqueItems(endpoint.expectStatus)
        && endpoint.expectStatus.every((status) => Number.isInteger(status) && status >= 100 && status <= 599);
      if (typeof endpoint.name !== 'string' || endpoint.name.length === 0
          || !isHttpsUrl(endpoint.url, { allowFragment: false })
          || !statusesValid
          || (Object.hasOwn(endpoint, 'provenanceField')
            && (typeof endpoint.provenanceField !== 'string' || endpoint.provenanceField.length === 0))) {
        throw new Error(`${service.id} has an invalid health endpoint`);
      }
    }
    if (!Array.isArray(service.staging.environments)) throw new Error(`${service.id}.staging.environments must be an array`);
    if (service.staging.environments.length > CATALOG_LIMITS.environmentsPerService) {
      throw new Error(`${service.id} must contain at most ${CATALOG_LIMITS.environmentsPerService} environments`);
    }
    aggregateChecks += service.staging.environments.length;
    assertVerifiedItems(service.id, 'staging', service.staging, 'environments');
    assertUniqueItems(service.id, 'staging.environments', service.staging.environments);
    for (const environment of service.staging.environments) {
      requireKeys(service.id, 'staging environment', environment, ['name', 'url']);
      if (typeof environment.name !== 'string' || environment.name.length === 0
          || !isHttpsUrl(environment.url, { allowFragment: false })) {
        throw new Error(`${service.id} has an invalid staging environment`);
      }
    }

    if (!Array.isArray(service.unresolvedRequirements)) throw new Error(`${service.id}.unresolvedRequirements must be an array`);
    if (service.unresolvedRequirements.length > CATALOG_LIMITS.requirementsPerService) {
      throw new Error(`${service.id} must contain at most ${CATALOG_LIMITS.requirementsPerService} requirements`);
    }
    aggregateChecks += service.unresolvedRequirements.length;
    if (aggregateChecks > CATALOG_LIMITS.aggregateChecks) {
      throw new Error(`catalog aggregate checks must not exceed ${CATALOG_LIMITS.aggregateChecks}`);
    }
    const requirementIds = new Set();
    for (const requirement of service.unresolvedRequirements) {
      requireKeys(service.id, 'unresolved requirement', requirement, ['id', 'kind', 'status', 'owner', 'blocks', 'reference']);
      if (!/^[a-z0-9-]+$/.test(requirement.id) || requirementIds.has(requirement.id)) throw new Error(`${service.id} has an invalid or duplicate requirement id`);
      requirementIds.add(requirement.id);
      if (!REQUIREMENT_KINDS.has(requirement.kind) || !['unresolved', 'external'].includes(requirement.status)) {
        throw new Error(`${service.id}.${requirement.id} has an invalid requirement state`);
      }
      if (!Array.isArray(requirement.blocks) || requirement.blocks.length === 0 || requirement.blocks.some((block) => !REQUIREMENT_BLOCKS.has(block))) {
        throw new Error(`${service.id}.${requirement.id} has invalid blocked proofs`);
      }
      assertUniqueItems(service.id, `${requirement.id}.blocks`, requirement.blocks);
      if (typeof requirement.owner !== 'string' || requirement.owner.length === 0) {
        throw new Error(`${service.id}.${requirement.id} has an invalid owner`);
      }
      if (!(isHttpsUrl(requirement.reference) || isRepositoryPath(requirement.reference))) {
        throw new Error(`${service.id}.${requirement.id} has an invalid requirement reference`);
      }
    }
    if (typeof service.mutationPolicy !== 'string' || service.mutationPolicy.length === 0) {
      throw new Error(`${service.id}.mutationPolicy must be nonempty`);
    }
    if (Object.hasOwn(service, 'runnerVerification')) {
      const requiredRunner = ['organization', 'groupId', 'groupName', 'repository', 'workflow', 'runnerName', 'labels'];
      requireKeys(service.id, 'runner verification', service.runnerVerification, requiredRunner);
      const runner = service.runnerVerification;
      if (typeof runner.organization !== 'string' || runner.organization.length === 0
          || !Number.isInteger(runner.groupId) || runner.groupId < 1
          || typeof runner.groupName !== 'string' || runner.groupName.length === 0
          || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(runner.repository)
          || typeof runner.workflow !== 'string' || runner.workflow.length === 0
          || typeof runner.runnerName !== 'string' || runner.runnerName.length === 0
          || !Array.isArray(runner.labels) || runner.labels.length === 0
          || !hasUniqueItems(runner.labels)
          || runner.labels.some((label) => typeof label !== 'string' || label.length === 0)) {
        throw new Error(`${service.id} has an invalid runner verification contract`);
      }
    }
  }
  return catalog;
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout ?? 10_000,
    }).trim();
  } catch (error) {
    if (options.optional) return null;
    const stderr = error?.stderr?.toString().trim();
    throw new Error(stderr || `${command} failed`);
  }
}

function parseArgs(argv) {
  const options = {
    catalog: DEFAULT_CATALOG,
    format: 'text',
    githubUser: null,
    noGithub: false,
    noHealth: false,
    strict: false,
    services: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--offline') {
      options.noGithub = true;
      options.noHealth = true;
    } else if (arg === '--no-github') options.noGithub = true;
    else if (arg === '--no-health') options.noHealth = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--json') options.format = 'json';
    else if (arg === '--catalog') options.catalog = resolve(REPO_ROOT, argv[++index] ?? '');
    else if (arg === '--github-user') options.githubUser = argv[++index] ?? '';
    else if (arg === '--service') options.services.push(argv[++index] ?? '');
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown doctor argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage: scripts/hb.mjs doctor [options]

  --service ID          inspect only one service (repeatable)
  --github-user LOGIN   inspect a collaborator's effective repository role
  --offline             skip GitHub and public health requests
  --no-github           skip GitHub permission checks
  --no-health           skip public health requests
  --strict              treat warnings as a failing exit status
  --json                emit machine-readable JSON`;
}

function gitEvidence() {
  const head = run('git', ['rev-parse', 'HEAD']);
  const branch = run('git', ['branch', '--show-current']) || '(detached)';
  const porcelain = run('git', ['status', '--porcelain=v1']);
  const upstream = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { optional: true });
  const tracking = upstream ? run('git', ['rev-list', '--left-right', '--count', `${upstream}...HEAD`], { optional: true }) : null;
  const [behind, ahead] = tracking ? tracking.split(/\s+/).map(Number) : [null, null];
  return {
    head,
    branch,
    upstream,
    clean: porcelain === '',
    changedEntries: porcelain === '' ? 0 : porcelain.split('\n').length,
    ahead,
    behind,
  };
}

function permissionRank(payload) {
  if (payload.role_name) return payload.role_name;
  const permissions = payload.permissions ?? {};
  return ['admin', 'maintain', 'push', 'triage', 'pull'].find((key) => permissions[key]) ?? 'none';
}

function githubPermission(repository, user) {
  if (user) {
    const payload = JSON.parse(run('gh', ['api', `repos/${repository}/collaborators/${user}/permission`]));
    return { login: payload.user?.login ?? user, permission: payload.role_name ?? payload.permission ?? 'unknown' };
  }
  const login = JSON.parse(run('gh', ['api', 'user'])).login;
  const payload = JSON.parse(run('gh', ['api', `repos/${repository}`]));
  return { login, permission: permissionRank(payload) };
}

export function githubContentsExist(payload) {
  return Array.isArray(payload) || (payload !== null && typeof payload === 'object' && typeof payload.sha === 'string');
}

function githubPathExists(repository, path, ref) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const payload = run('gh', ['api', `repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`], { optional: true });
  return payload !== null && githubContentsExist(JSON.parse(payload));
}

function githubBranchProtection(repository, branch) {
  const payload = run('gh', ['api', `repos/${repository}/branches/${encodeURIComponent(branch)}/protection`], { optional: true });
  return payload === null ? null : JSON.parse(payload);
}

function githubRunnerEvidence(expected) {
  const group = JSON.parse(run('gh', ['api', `orgs/${expected.organization}/actions/runner-groups/${expected.groupId}`]));
  const repositories = JSON.parse(run('gh', ['api', `orgs/${expected.organization}/actions/runner-groups/${expected.groupId}/repositories`])).repositories ?? [];
  const runners = JSON.parse(run('gh', ['api', `orgs/${expected.organization}/actions/runner-groups/${expected.groupId}/runners`])).runners ?? [];
  const runner = runners.find(({ name }) => name === expected.runnerName);
  const actualLabels = new Set((runner?.labels ?? []).map(({ name }) => name));
  const mismatches = [];
  if (group.name !== expected.groupName) mismatches.push(`group=${group.name}`);
  if (!group.restricted_to_workflows || !group.selected_workflows?.includes(expected.workflow)) mismatches.push('workflow restriction');
  if (!repositories.some(({ full_name: name }) => name === expected.repository)) mismatches.push('repository selection');
  if (!runner || runner.status !== 'online') mismatches.push(`runner=${runner?.status ?? 'missing'}`);
  if (expected.labels.some((label) => !actualLabels.has(label))) mismatches.push('runner labels');
  return { ok: mismatches.length === 0, detail: mismatches.length ? `drift: ${mismatches.join(', ')}` : `${group.name}; ${runner.name} online; exact workflow restriction` };
}

function deployedRevisionEvidence(repository, revision, lanes, noGithub) {
  if (!/^[0-9a-f]{40}$/.test(revision)) return result('warning', 'revision-drift', 'service returned malformed provenance');
  if (!noGithub && repository) {
    const containing = [];
    for (const lane of lanes) {
      const status = run('gh', ['api', `repos/${repository}/compare/${revision}...${encodeURIComponent(lane)}`, '--jq', '.status'], { optional: true });
      if (status === 'ahead' || status === 'identical') containing.push(lane);
    }
    if (containing.length > 0) return result('ok', 'revision-drift', `${revision} contained in remote ${containing.join(', ')}`);
    return result('warning', 'revision-drift', `${revision} is not contained in a configured remote lane`);
  }
  const present = run('git', ['cat-file', '-e', `${revision}^{commit}`], { optional: true }) !== null;
  if (!present) return result('warning', 'revision-drift', `${revision} is not present in the local object database`);
  const containing = [];
  for (const lane of lanes) {
    for (const ref of [`upstream/${lane}`, lane]) {
      if (run('git', ['rev-parse', '--verify', '--quiet', ref], { optional: true }) === null) continue;
      if (run('git', ['merge-base', '--is-ancestor', revision, ref], { optional: true }) !== null) containing.push(ref);
    }
  }
  if (containing.length === 0) return result('warning', 'revision-drift', `${revision} is not contained in a configured lane`);
  return result('ok', 'revision-drift', `${revision} contained in cached ${[...new Set(containing)].join(', ')}`);
}

async function healthEvidence(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch(endpoint.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'application/json,text/plain;q=0.5', 'user-agent': 'hb-doctor/1' },
    });
    let provenance = null;
    let serviceStatus = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json')) {
      const text = (await response.text()).slice(0, 65_536);
      try {
        const payload = JSON.parse(text);
        provenance = endpoint.provenanceField ? payload?.[endpoint.provenanceField] ?? null : null;
        serviceStatus = typeof payload?.status === 'string' && /^[a-z0-9_-]{1,32}$/i.test(payload.status)
          ? payload.status
          : null;
      } catch {
        serviceStatus = 'invalid-json';
      }
    } else {
      await response.body?.cancel();
    }
    return { status: response.status, ok: endpoint.expectStatus.includes(response.status), provenance, serviceStatus };
  } finally {
    clearTimeout(timer);
  }
}

function typedEvidence(check, evidence, facts = {}) {
  const detail = [`status=${evidence.status}`];
  for (const [key, value] of Object.entries(facts)) {
    if (value !== null && value !== undefined && value !== '') detail.push(`${key}=${value}`);
  }
  return result(EVIDENCE_LEVEL[evidence.status], check, detail.join(' '));
}

export async function inspect({ catalog, options }) {
  validateCatalog(catalog);
  const selected = options.services.length
    ? catalog.services.filter((service) => options.services.includes(service.id))
    : catalog.services;
  const missing = options.services.filter((id) => !catalog.services.some((service) => service.id === id));
  const maximumReportEntries = 2 + missing.length + selected.reduce((count, service) => (
    count + 16 + (service.runnerVerification ? 1 : 0)
      + service.unresolvedRequirements.length + (2 * service.health.endpoints.length)
      + service.localPaths.length + (service.workflows?.length ?? 0) + (service.recoveryDocs?.length ?? 0)
      + (service.branchSources ?? []).reduce((total, source) => (
        total + source.paths.length + source.workflows.length + source.recoveryDocs.length
      ), 0)
      + (service.deliveryPolicy?.protectedBranches.length ?? 0)
  ), 0);
  if (maximumReportEntries > CATALOG_LIMITS.reportEntries) {
    throw new Error(`doctor report entries must not exceed ${CATALOG_LIMITS.reportEntries}`);
  }
  const results = [];
  let git = null;
  try {
    git = gitEvidence();
    results.push(result(git.clean ? 'ok' : 'warning', 'repository.worktree', git.clean ? 'clean' : `${git.changedEntries} changed entries`));
    results.push(result(git.upstream ? 'ok' : 'warning', 'repository.tracking', git.upstream ? `ahead=${git.ahead} behind=${git.behind}` : 'no configured upstream'));
  } catch (error) {
    results.push(result('error', 'repository.git', error.message));
  }

  for (const id of missing) results.push(result('error', `service.${id}`, 'not present in catalog'));

  const localRepository = run('git', ['config', '--get', 'remote.upstream.url'], { optional: true })
    ?? run('git', ['config', '--get', 'remote.origin.url'], { optional: true });
  const isLocalRepo = (repository) => repository && localRepository?.includes(repository);

  for (const service of selected) {
    const repository = service.repository.slug;
    const publicRepository = ['verified', 'documented'].includes(service.repository.status) ? repository : null;
    const lanes = [...new Set([service.integrationLane.name, service.deliveryLane.name].filter(Boolean))];

    results.push(typedEvidence(`${service.id}.owner`, service.owner, {
      name: ['verified', 'documented'].includes(service.owner.status) ? service.owner.name : null,
    }));
    results.push(typedEvidence(`${service.id}.repository`, service.repository, { slug: publicRepository }));
    results.push(typedEvidence(`${service.id}.integration-lane`, service.integrationLane, {
      name: ['verified', 'documented'].includes(service.integrationLane.status) ? service.integrationLane.name : null,
    }));
    results.push(typedEvidence(`${service.id}.delivery-lane`, service.deliveryLane, {
      name: ['verified', 'documented'].includes(service.deliveryLane.status) ? service.deliveryLane.name : null,
    }));
    results.push(typedEvidence(`${service.id}.ci-workflow`, service.ciWorkflow, {
      path: ['verified', 'documented'].includes(service.ciWorkflow.status) ? service.ciWorkflow.path : null,
    }));
    results.push(typedEvidence(`${service.id}.deploy-adapter`, service.deployAdapter, { kind: service.deployAdapter.kind }));
    results.push(typedEvidence(`${service.id}.deployed-revision`, service.deployedRevision, {
      revision: service.deployedRevision.status === 'verified' ? service.deployedRevision.value : null,
    }));
    results.push(typedEvidence(`${service.id}.artifact-fingerprint`, service.artifactFingerprint, { kind: service.artifactFingerprint.kind }));
    results.push(typedEvidence(`${service.id}.health-contract`, service.health, { endpoints: service.health.endpoints.length }));
    results.push(typedEvidence(`${service.id}.alerts.route`, service.alerts.route, { kind: service.alerts.route.kind }));
    results.push(typedEvidence(`${service.id}.alerts.recipient-proof`, service.alerts.recipientProof));
    results.push(typedEvidence(`${service.id}.recovery.target`, service.recovery.target, { kind: service.recovery.target.kind }));
    results.push(typedEvidence(`${service.id}.recovery.proof`, service.recovery.proof));
    results.push(typedEvidence(`${service.id}.staging`, service.staging, { environments: service.staging.environments.length }));
    results.push(typedEvidence(`${service.id}.staging.drill`, service.staging.drill));
    for (const requirement of service.unresolvedRequirements) {
      results.push(result('error', `${service.id}.requirement.${requirement.id}`, `status=${requirement.status} kind=${requirement.kind}`));
    }

    if (!publicRepository) {
      results.push(result('skipped', `${service.id}.github`, 'repository access is not established'));
    } else if (options.noGithub) {
      results.push(result('skipped', `${service.id}.github`, 'network checks disabled'));
    } else {
      try {
        const permission = githubPermission(publicRepository, options.githubUser);
        const usable = ['admin', 'maintain', 'write', 'push'].includes(permission.permission);
        results.push(result(usable ? 'ok' : 'warning', `${service.id}.github`, `${permission.login}: ${permission.permission}`));
      } catch {
        results.push(result('warning', `${service.id}.github`, 'repository permission is not visible to the current GitHub credential'));
      }
    }
    if (isLocalRepo(publicRepository)) {
      results.push(...inspectLocalRoutes(service).map((item) => ({
        ...item,
        detail: item.level === 'ok' ? 'present' : 'missing',
      })));
    }
    for (const source of service.branchSources ?? []) {
      if (options.noGithub || !publicRepository) {
        results.push(result('skipped', `${service.id}.branch-source`, `${source.ref}: network checks disabled or repository unresolved`));
      } else {
        results.push(...await inspectBranchSource(
          service,
          source,
          (path, ref) => githubPathExists(publicRepository, path, ref),
        ));
      }
    }
    if (service.deliveryPolicy) {
      for (const branch of service.deliveryPolicy.protectedBranches) {
        if (options.noGithub || !publicRepository) {
          results.push(result('skipped', `${service.id}.delivery-protection`, `${branch}: network checks disabled or repository unresolved`));
        } else {
          const evidence = evaluateDeliveryProtection(
            service.deliveryPolicy,
            branch,
            githubBranchProtection(publicRepository, branch),
          );
          results.push(result(evidence.ok ? 'ok' : 'error', `${service.id}.delivery-protection`, evidence.detail));
        }
      }
    }
    if (service.runnerVerification) {
      if (options.noGithub) {
        results.push(result('skipped', `${service.id}.runner-live`, 'network checks disabled'));
      } else {
        try {
          const runner = githubRunnerEvidence(service.runnerVerification);
          results.push(result(runner.ok ? 'ok' : 'error', `${service.id}.runner-live`, runner.detail));
        } catch {
          results.push(result('warning', `${service.id}.runner-live`, 'runner evidence is not visible to the current GitHub credential'));
        }
      }
    }

    const deployedRevisions = [];
    for (const endpoint of service.health.endpoints) {
      if (options.noHealth) {
        results.push(result('skipped', `${service.id}.${endpoint.name}`, 'network checks disabled'));
        continue;
      }
      try {
        const evidence = await healthEvidence(endpoint);
        const detail = [`HTTP ${evidence.status}`];
        if (evidence.serviceStatus) detail.push(`status=${evidence.serviceStatus}`);
        if (evidence.provenance && /^[0-9a-f]{40}$/.test(evidence.provenance)) {
          detail.push(`revision=${evidence.provenance}`);
          deployedRevisions.push(evidence.provenance);
        } else if (evidence.provenance) {
          detail.push('revision=malformed');
        }
        results.push(result(evidence.ok ? 'ok' : 'error', `${service.id}.${endpoint.name}`, detail.join(' '), { evidence }));
      } catch {
        results.push(result('error', `${service.id}.${endpoint.name}`, 'public health request failed'));
      }
    }
    if (isLocalRepo(publicRepository)) {
      for (const revision of [...new Set(deployedRevisions)]) {
        const drift = deployedRevisionEvidence(publicRepository, revision, lanes, options.noGithub);
        results.push({ ...drift, check: `${service.id}.${drift.check}` });
      }
    }
  }

  const summary = results.reduce((counts, item) => {
    counts[item.level] = (counts[item.level] ?? 0) + 1;
    return counts;
  }, { ok: 0, warning: 0, error: 0, skipped: 0 });
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), git, selectedServices: selected.map(({ id }) => id), results, summary };
}

function printText(report) {
  if (report.git) {
    console.log(sanitizeText(`repository ${report.git.branch} ${report.git.head}${report.git.upstream ? ` upstream=${report.git.upstream}` : ''}`, 512));
  }
  for (const item of report.results) {
    console.log(sanitizeText(`${item.level.toUpperCase().padEnd(7)} ${item.check}: ${item.detail}`, 512));
  }
  const { ok, warning, error, skipped } = report.summary;
  console.log(sanitizeText(`summary ok=${ok} warning=${warning} error=${error} skipped=${skipped}`, 512));
}

function readCatalog(path) {
  if (statSync(path).size > CATALOG_LIMITS.catalogBytes) throw new Error('catalog exceeds byte limit');
  const bytes = readFileSync(path);
  if (bytes.length > CATALOG_LIMITS.catalogBytes) throw new Error('catalog exceeds byte limit');
  return bytes.toString('utf8');
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    const catalog = validateCatalog(JSON.parse(readCatalog(options.catalog)));
    const report = await inspect({ catalog, options });
    if (options.format === 'json') console.log(JSON.stringify(report, null, 2));
    else printText(report);
    if (report.summary.error > 0) return 1;
    if (options.strict && report.results.some((item) => LEVEL_ORDER[item.level] >= LEVEL_ORDER.warning)) return 1;
    return 0;
  } catch {
    console.error(GENERIC_CATALOG_ERROR);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    console.error(GENERIC_CATALOG_ERROR);
    process.exitCode = 1;
  });
}
