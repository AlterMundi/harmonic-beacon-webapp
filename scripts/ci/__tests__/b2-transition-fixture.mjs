import { validManifest } from './b2-fixture.mjs';
import { canonicalize, publicConfigSha256 as digest, transitionCommandTranscriptSha256, transitionOutputTranscriptSha256 } from '../release-manifest.mjs';

const SERVICES = ['postgres', 'livekit', 'app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'analytics'];
const ENDPOINTS = ['app-health', 'app-ready', 'tapestry-health', 'analytics-ready', 'livekit'];
const NETWORKS = ['database', 'media'];
const bytes = value => Buffer.from(canonicalize(value));

export const RUNTIME_MEASUREMENT_OPERATIONS = [
  'measure-runtime-inventory',
  ...SERVICES.flatMap(service => [`measure-runtime-container-${service}`, `measure-runtime-image-${service}`]),
  ...['app', 'livekit', 'tapestry', 'analytics'].map(service => `measure-runtime-address-${service}`),
  ...ENDPOINTS.map(endpoint => `measure-runtime-endpoint-${endpoint}`),
  ...NETWORKS.map(network => `measure-private-network-${network}`),
];

export const COMPATIBILITY_OPERATIONS = [
  'check-schema-head',
  'check-browser-endpoints',
  'check-synthetic-session',
  'check-commerce-heartbeat',
  'check-commerce-backlog',
  ...NETWORKS.map(network => `check-private-network-${network}`),
  'check-runtime-inventory',
  ...SERVICES.map(service => `check-runtime-environment-${service}`),
  'check-backup',
  'check-restore-drop',
  'check-restore-create',
  'check-restore-apply',
  'check-restore-count',
  'check-restore-cleanup',
];

const transitionOperations = {
  shadow: [
    'configure-candidate-live-staging',
    'migrate-candidate-app',
    'migrate-candidate-analytics',
    'replace-candidate-live-staging',
  ],
  rollback: [
    'configure-candidate-production',
    'replace-candidate-production',
    'configure-base-production',
    'replace-base-production',
  ],
  'forward-repair': [
    'configure-candidate-production',
    'replace-candidate-production',
  ],
};

export function stageContract(stage) {
  const preparation = stage === 'rollback' ? transitionOperations.rollback.slice(0, 2) : [];
  const transition = stage === 'rollback'
    ? transitionOperations.rollback.slice(2)
    : transitionOperations[stage];
  const operations = [
    ...preparation,
    ...RUNTIME_MEASUREMENT_OPERATIONS,
    ...transition,
    ...RUNTIME_MEASUREMENT_OPERATIONS,
    ...COMPATIBILITY_OPERATIONS,
  ];
  const beforeStart = preparation.length;
  const beforeEnd = beforeStart + RUNTIME_MEASUREMENT_OPERATIONS.length;
  const afterStart = beforeEnd + transition.length;
  return {
    operations,
    before: [beforeStart, beforeEnd],
    after: [afterStart, afterStart + RUNTIME_MEASUREMENT_OPERATIONS.length],
  };
}

const executableFor = operation => operation === 'check-browser-endpoints'
  ? 'npx'
  : operation.startsWith('measure-runtime-endpoint-') ? 'curl' : 'docker';

function command(stage, operation, index, start) {
  const executableIdentity = executableFor(operation);
  return {
    operation,
    executableIdentity: `/usr/bin/${executableIdentity}`,
    executableSha256: digest(`executable:${executableIdentity}`),
    argvSha256: digest(`${stage}:${index}:argv`),
    environmentSha256: digest(`${stage}:${index}:environment`),
    stdinSha256: digest(`${stage}:${index}:stdin`),
    startedAt: new Date(start).toISOString(),
    completedAt: new Date(start + 1).toISOString(),
    exitCode: 0,
    stdoutSha256: digest(`${stage}:${index}:stdout`),
    stderrSha256: digest(`${stage}:${index}:stderr`),
  };
}

function runtime(commands, range, manifestSha256, configSha256) {
  const [commandStart, commandEnd] = range;
  const transcript = commands.slice(commandStart, commandEnd);
  const health = transcript.filter(command => command.operation.startsWith('measure-runtime-endpoint-'));
  const privateBoundary = transcript.filter(command => command.operation.startsWith('measure-runtime-container-') || command.operation.startsWith('measure-private-network-'));
  return {
    manifestSha256,
    configSha256,
    commandStart,
    commandEnd,
    runtimeCommandTranscriptSha256: transitionCommandTranscriptSha256(transcript),
    healthCommandTranscriptSha256: transitionOutputTranscriptSha256(health),
    privateBoundaryCommandTranscriptSha256: transitionOutputTranscriptSha256(privateBoundary),
  };
}

export function validTransitionFixture() {
  const manifest = validManifest();
  const qualification = {
    qualificationJob: 'qualify', measurementStartedAt: '2026-09-10T17:40:00.000Z', measurementCompletedAt: '2026-09-10T17:49:00.000Z', issuedAt: manifest.qualification.qualifiedAt,
    schemaVersion: 'oci-qualification.v3', result: 'success', workflowRunId: manifest.build.workflowRunId,
    workflowRunAttempt: 1, candidateIdentitySha256: manifest.qualification.candidateIdentitySha256,
    imageRefs: Object.fromEntries([...manifest.artifacts, ...manifest.externalImages].map(entry => [entry.artifactId ?? entry.serviceId, `${entry.repository}@${entry.digest}`])),
    checkedServices: SERVICES,
    acceptance: { browser: { engine: 'chromium', passed: 1, failed: 0, skipped: 0 }, syntheticSession: { created: 1, authenticatedRole: 'ADMIN' }, commerce: { workerHeartbeatAgeMs: 0, pending: 0, processing: 0 }, schema: { expectedHead: manifest.migrationSet.head, observedHead: manifest.migrationSet.head }, isolation: { internalNetworks: NETWORKS, forbiddenSecretNamesFound: [] }, restore: { backupSha256: digest('dump'), backupBytes: 1, restoredSessionCount: 1 } },
  };
  manifest.qualification.receiptSha256 = digest(bytes(qualification));
  const manifestBytes = bytes(manifest);
  const binding = { candidateManifestSha256: digest(manifestBytes).slice(7), baseManifestSha256: manifest.promotion.baseManifestSha256, qualificationReceiptSha256: manifest.qualification.receiptSha256, workflowRunId: manifest.build.workflowRunId, workflowRunAttempt: 1 };
  const authorization = { schemaVersion: 'harmonic-beacon.oci-transition.v4', laneState: 'oci-production', ...binding, authorizedAt: '2026-09-10T18:00:00.000Z', expiresAt: '2026-09-10T19:00:00.000Z', stages: {} };
  const stages = {};
  let stageStart = Date.parse('2026-09-10T17:50:00.000Z');
  for (const stage of ['shadow', 'rollback', 'forward-repair']) {
    const contract = stageContract(stage);
    const commands = contract.operations.map((operation, index) => command(stage, operation, index, stageStart + 1 + (index * 2)));
    const completedAt = stageStart + 2 + (commands.length * 2);
    const configSha256 = manifest.configProfiles[stage === 'shadow' ? 'live-staging' : 'production'].sha256;
    const beforeManifest = stage === 'rollback' ? binding.candidateManifestSha256 : binding.baseManifestSha256;
    const afterManifest = stage === 'rollback' ? binding.baseManifestSha256 : binding.candidateManifestSha256;
    const execution = {
      schemaVersion: `harmonic-beacon.${stage}-execution.v4`, stage, ...binding,
      startedAt: new Date(stageStart).toISOString(), completedAt: new Date(completedAt).toISOString(), commands,
      runtimeBefore: runtime(commands, contract.before, beforeManifest, configSha256),
      runtimeAfter: runtime(commands, contract.after, afterManifest, configSha256),
      ...(stage === 'shadow' ? {} : { observedRecoveryMs: completedAt - stageStart, maxRecoveryMs: 900000 }),
    };
    const executionBytes = bytes(execution);
    const receiptBytes = bytes({ schemaVersion: `harmonic-beacon.${stage}-receipt.v4`, stage, ...binding, executionEvidenceSha256: digest(executionBytes), issuedAt: new Date(completedAt + 1).toISOString() });
    stages[stage] = { executionBytes, receiptBytes };
    authorization.stages[stage] = { receiptSha256: digest(receiptBytes), executionEvidenceSha256: digest(executionBytes) };
    stageStart = completedAt + 2;
  }
  return { manifest, manifestBytes, qualificationBytes: bytes(qualification), authorizationBytes: bytes(authorization), stages, now: Date.parse(authorization.authorizedAt) };
}

export function resealStage(fixture, stage) {
  const executionBytes = bytes(JSON.parse(fixture.stages[stage].executionBytes));
  fixture.stages[stage].executionBytes = executionBytes;
  const receipt = JSON.parse(fixture.stages[stage].receiptBytes);
  receipt.executionEvidenceSha256 = digest(executionBytes);
  fixture.stages[stage].receiptBytes = bytes(receipt);
  const authorization = JSON.parse(fixture.authorizationBytes);
  authorization.stages[stage] = { executionEvidenceSha256: digest(executionBytes), receiptSha256: digest(fixture.stages[stage].receiptBytes) };
  fixture.authorizationBytes = bytes(authorization);
  return fixture;
}
