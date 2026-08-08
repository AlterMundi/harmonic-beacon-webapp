import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sha256File } from '../src/inventory.mjs';

test('hashes media through the incremental read stream helper', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'beacon-inventory-'));
  const fixture = path.join(directory, 'immutable-master.wav');
  const contents = Buffer.alloc(1024 * 1024, 7);
  await fs.writeFile(fixture, contents);
  const expected = crypto.createHash('sha256').update(contents).digest('hex');
  assert.equal(await sha256File(fixture), expected);
});
