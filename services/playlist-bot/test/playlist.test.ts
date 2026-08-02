import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolvePlaylist } from '../src/playlist.js';

test('selects one configured WAV instead of mixing it with the rollback OGG', () => {
  const records = mkdtempSync(join(tmpdir(), 'beacon-playlist-'));
  const wav = join(records, 'luz_de_manana_long.wav');
  writeFileSync(wav, 'wav');
  writeFileSync(join(records, 'luz_de_manana.ogg'), 'ogg');

  assert.deepEqual(resolvePlaylist(records, wav), [wav]);
});

test('scans supported stereo source containers deterministically when no source is configured', () => {
  const records = mkdtempSync(join(tmpdir(), 'beacon-playlist-'));
  writeFileSync(join(records, 'b.wav'), 'wav');
  writeFileSync(join(records, 'a.ogg'), 'ogg');
  writeFileSync(join(records, 'notes.txt'), 'ignore');

  assert.deepEqual(resolvePlaylist(records), [
    join(records, 'a.ogg'),
    join(records, 'b.wav'),
  ]);
});

test('fails closed for a missing, unsupported or out-of-directory configured source', () => {
  const records = mkdtempSync(join(tmpdir(), 'beacon-playlist-'));
  writeFileSync(join(records, 'notes.txt'), 'ignore');

  assert.deepEqual(resolvePlaylist(records, 'missing.wav'), []);
  assert.deepEqual(resolvePlaylist(records, 'notes.txt'), []);
  assert.deepEqual(resolvePlaylist(records, '../outside.wav'), []);
});
