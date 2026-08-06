import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const master = argument('--master');
const output = argument('--output');
if (!master || !output) {
  console.error('usage: node scripts/inventory.mjs --master /read-only/master.wav --output media/inventory.json');
  process.exit(2);
}

const masterPath = path.resolve(master);
const outputPath = path.resolve(output);
if (masterPath === outputPath) {
  throw new Error('refusing to write an inventory over the master');
}
const stat = await fs.stat(masterPath);
if (!stat.isFile()) throw new Error('master must be a regular file');
const bytes = await fs.readFile(masterPath);
const inventory = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  master: {
    immutable: true,
    path: masterPath,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: stat.size,
  },
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
const temporary = `${outputPath}.${process.pid}.tmp`;
await fs.writeFile(temporary, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
await fs.rename(temporary, outputPath);
console.log(`inventory written for ${inventory.master.bytes} immutable bytes`);
