import assert from 'node:assert/strict';
import test from 'node:test';

import {
  qualificationCommands,
  parseQualificationArgs,
  validateQualificationEvidence,
} from '../qualify-oci.mjs';

test('qualification uses exact manifest refs and forbids every rebuild path', () => {
  const refs = {
    app: 'ghcr.io/altermundi/harmonic-beacon-app@sha256:' + 'a'.repeat(64),
    tapestry: 'ghcr.io/altermundi/harmonic-beacon-tapestry@sha256:' + 'b'.repeat(64),
    'playlist-bot': 'ghcr.io/altermundi/harmonic-beacon-playlist-bot@sha256:' + 'c'.repeat(64),
    analytics: 'ghcr.io/altermundi/harmonic-beacon-analytics@sha256:' + 'd'.repeat(64),
    postgres: 'docker.io/library/postgres@sha256:' + 'e'.repeat(64),
    livekit: 'docker.io/livekit/livekit-server@sha256:' + 'f'.repeat(64),
  };
  const commands = qualificationCommands({ compose: 'deploy/qualification.compose.yml', project: 'candidate-a', refs });
  assert.ok(commands.length > 2);
  for (const { file, args } of commands) {
    const command = [file, ...args].join(' ');
    assert.equal(command.split(/\s+/u).includes('build'), false);
    if (file === 'docker' && args[0] === 'compose' &&
        (args.includes('up') || args.includes('run'))) {
      assert.match(command, /--no-build/u);
      assert.match(command, /--pull never/u);
    }
  }
});

test('qualification refuses omission of the explicit no-build acknowledgement', () => {
  assert.throws(() => parseQualificationArgs([
    '--manifest', 'release-manifest.json',
    '--compose', 'deploy/qualification.compose.yml',
  ]), /--no-build is mandatory/);
});

test('qualification receipt closes every exact-digest acceptance check', () => {
  const evidence = {
    browser: { engine: 'chromium', passed: 1, failed: 0, skipped: 0 },
    syntheticSession: { created: 1, authenticatedRole: 'ADMIN' },
    commerce: { workerHeartbeatAgeMs: 50, pending: 0, processing: 0 },
    schema: { expectedHead: '20260909120000_example', observedHead: '20260909120000_example' },
    isolation: { internalNetworks: ['database', 'media'], forbiddenSecretNamesFound: [] },
    restore: { backupSha256: `sha256:${'a'.repeat(64)}`, backupBytes: 10, restoredSessionCount: 1 },
  };
  assert.deepEqual(validateQualificationEvidence(evidence), evidence);
  assert.throws(
    () => validateQualificationEvidence({ ...evidence, browser: { ...evidence.browser, passed: 0 } }),
    /browser acceptance/u,
  );
  assert.throws(
    () => validateQualificationEvidence({ ...evidence, syntheticSession: { authenticatedRole: 'ADMIN' } }),
    /synthetic session/u,
  );
  assert.throws(
    () => validateQualificationEvidence({ ...evidence, commerce: { ...evidence.commerce, pending: Number.NaN } }),
    /commerce/u,
  );
  assert.throws(
    () => validateQualificationEvidence({ ...evidence, restore: { ...evidence.restore, restoredSessionCount: Number.NaN } }),
    /restore/u,
  );
  const missing = structuredClone(evidence);
  delete missing.restore;
  assert.throws(() => validateQualificationEvidence(missing), /acceptance evidence fields/u);
});
