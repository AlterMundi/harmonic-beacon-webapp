import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFile(path.join(root, name), 'utf8');

test('synthetic env cannot accidentally name production or payment providers', async () => {
  const source = await read('preview.env.synthetic.example');
  assert.match(source, /^EARLYBIRDS_PREVIEW_ENV=synthetic$/m);
  assert.doesNotMatch(source, /harmonicbeacon\.com|paypal|mercadopago/i);
});

test('preview compose has an isolated database and an on-demand migration rehearsal', async () => {
  const source = await read('compose.yml');
  assert.match(source, /postgres:/);
  assert.match(source, /earlybirds-preview-postgres/);
  assert.match(source, /migration-rehearsal:/);
  assert.match(source, /profiles: \[migration\]/);
  assert.match(source, /prisma", "migrate", "deploy/);
  assert.doesNotMatch(source, /livekit|playlist-bot|tapestry/i);
});
