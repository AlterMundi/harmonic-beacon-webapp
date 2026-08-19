#!/usr/bin/env node

import fs from 'node:fs';

const requiredFiles = [
  '/app/scripts/listener-account-production/sync-secret.mjs',
  '/app/scripts/listener-account-production/preflight.mjs',
  '/app/scripts/listener-account-production/activate-env.mjs',
];

for (const file of requiredFiles) {
  const metadata = fs.statSync(file);
  if (!metadata.isFile()) throw new Error('Listener production Account lifecycle file is missing from the image');
}
process.stdout.write('Listener production Account image contract is present.\n');
