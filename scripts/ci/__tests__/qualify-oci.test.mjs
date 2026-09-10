import assert from 'node:assert/strict';
import test from 'node:test';

import { qualificationCommands, parseQualificationArgs } from '../qualify-oci.mjs';

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
    if (file === 'docker' && args[0] === 'compose') {
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
