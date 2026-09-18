// Synthetic contract fixtures only; no measured hosted or Mona evidence.
import { canonicalize, publicConfigSha256 as digest } from '../release-manifest.mjs';

const NOW = Date.parse('2026-09-16T12:00:00.000Z');
const bytes = value => Buffer.from(canonicalize(value));
const H = label => digest(label);
function observation() {
  return {
    schemaVersion: 'harmonic-beacon.legacy-observation.v1', host: 'mona', observedAt: new Date(NOW - 1000).toISOString(),
    implementationSha256: H('implementation'), profileSha256: H('profile'),
    gateState: { genesisId: H('epoch').slice(7), permitSha256: H('permit'), ledgerSha256: null, publication: null },
    services: Object.fromEntries(['app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'postgres', 'livekit'].map(service => [service, {
      containerId: H(`container:${service}`).slice(7), configuredImage: `${service}:legacy`, imageId: H(`image:${service}`),
      platform: 'linux/amd64', composeProject: 'app', effectiveConfigSha256: H(`config:${service}`), sourceIdentity: { kind: 'unknown' },
      dependencyResolution: ['postgres', 'livekit'].includes(service) ? {
        indexRef: `docker.io/${service === 'postgres' ? 'library/postgres' : 'livekit/livekit-server'}@${H(service)}`,
        platformManifestDigest: H(`platform:${service}`), imageId: H(`image:${service}`),
      } : null,
    }])),
    configCommitment: H('private-effective-runtime-projection'),
    boundary: { readiness: 'passed', privateBoundary: 'passed', liveDatabaseSessions: 0, realLivekitParticipants: 0, publishedUserAudioTracks: 0 },
    reportedAppGitSha: 'a'.repeat(40),
  };
}

function authorization(operation = 'genesis') {
  const o = observation();
  return {
    schemaVersion: 'harmonic-beacon.genesis-authorization.v1', host: 'mona', genesisId: o.gateState.genesisId,
    operation, target: 'production', workflowPath: '.github/workflows/oci-promote.yml', workflowRef: 'refs/heads/main', environment: 'production',
    deliveryRunId: '987', deliveryRunAttempt: 2, candidateRunId: '123', candidateRunAttempt: 1,
    sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), manifestSha256: H('manifest').slice(7), configSha256: H('config'),
    legacyObservationSha256: H(bytes(o)), legacyRuntimeSha256: o.configCommitment, profileSha256: o.profileSha256,
    implementationSha256: o.implementationSha256, hostedRehearsalSha256: H('rehearsal'),
    expectedPublication: operation === 'genesis' ? null : { generation: 1, id: H('publication').slice(7), manifestSha256: H('manifest').slice(7) },
    expectedLedgerSha256: operation === 'genesis' ? null : H('ledger'), permitSha256: o.gateState.permitSha256,
    verbs: operation === 'genesis-recover' ? ['prepare', 'recover', 'status'] : ['prepare', 'apply', 'status', 'recover'],
    authorizedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 900000).toISOString(),
  };
}

function rehearsal() {
  const a = authorization();
  const stage = (name, from, to, index) => ({
    stage: name, from, to, startedAt: new Date(NOW - 10000 + index * 2000).toISOString(), completedAt: new Date(NOW - 9000 + index * 2000).toISOString(),
    commandReceiptSha256: H(`commands:${name}`), outputReceiptSha256: H(`outputs:${name}`), runtimeReceiptSha256: H(`runtime:${name}`), result: 'success',
  });
  return {
    schemaVersion: 'harmonic-beacon.genesis-rehearsal.v1', scope: 'hosted-mechanics', environment: 'shadow',
    workflowPath: a.workflowPath, workflowRef: a.workflowRef, manifestSha256: a.manifestSha256,
    sourceSha: a.sourceSha, sourceTree: a.sourceTree, candidateRunId: a.candidateRunId, candidateRunAttempt: a.candidateRunAttempt,
    deliveryRunId: a.deliveryRunId, deliveryRunAttempt: a.deliveryRunAttempt,
    implementationSha256: a.implementationSha256, profileSha256: a.profileSha256, harnessSha256: H('harness'),
    fixtureIdentity: { kind: 'synthetic-six-service', id: H('fixture').slice(7) },
    stages: [stage('adopt', 'legacy-shaped', 'genesis', 0), stage('recover', 'genesis', 'legacy-shaped', 1), stage('forward-repair', 'legacy-shaped', 'genesis', 2)],
    failureRecovery: { scenario: 'interrupted-adoption', result: 'success', commandReceiptSha256: H('failure commands'), outputReceiptSha256: H('failure outputs'), runtimeReceiptSha256: H('failure runtime'), startedAt: new Date(NOW - 4000).toISOString(), completedAt: new Date(NOW - 3000).toISOString() },
    startedAt: new Date(NOW - 10000).toISOString(), completedAt: new Date(NOW - 3000).toISOString(), issuedAt: new Date(NOW - 2000).toISOString(), result: 'success',
  };
}

export { observation, authorization, rehearsal, NOW, bytes, H };
