#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [directory, sha, image, config] = process.argv.slice(2);
if (process.argv.length !== 6 || !/^[0-9a-f]{40}$/.test(sha) ||
    !/^sha256:[0-9a-f]{64}$/.test(image) || !/^[0-9a-f]{64}$/.test(config)) {
    throw new Error('exact staged image coordinates required');
}
const owner = process.getuid();
const checked = (file, isDirectory = false) => {
    const info = fs.lstatSync(file);
    if (info.uid !== owner || (info.mode & 0o777) !== (isDirectory ? 0o700 : 0o600) ||
        !(isDirectory ? info.isDirectory() : info.isFile()) ||
        (!isDirectory && (info.nlink !== 1 || info.size > 65536))) {
        throw new Error('unsafe staging receipt custody');
    }
};
checked(directory, true);
const names = fs.readdirSync(directory);
if (names.length > 1000) throw new Error('receipt inventory exceeds bound');
let found = false;
for (const name of names.filter(n => /^staging-[1-9][0-9]{0,19}-[1-9][0-9]{0,8}\.json$/.test(n))) {
    const file = path.join(directory, name);
    checked(file);
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (receipt.evidence_scope !== 'runtime' || receipt.target !== 'staging' ||
        receipt.outcome !== 'deployed' || receipt.source_sha !== sha ||
        receipt.artifact?.source_sha !== sha || receipt.artifact?.image_id !== image ||
        receipt.config_contract_sha256 !== config) continue;
    const result = spawnSync(process.execPath,
        [path.join(import.meta.dirname, 'validate-receipt.mjs'), file],
        { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
    if (result.status !== 0) throw new Error('staging receipt failed complete validation');
    found = true;
    break;
}
if (!found) throw new Error('no successful staging receipt binds this exact image/source/configuration');
console.log('Exact healthy staging artifact is bound by its retained runtime receipt; no rebuild.');
