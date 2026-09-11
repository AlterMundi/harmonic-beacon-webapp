#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const [repository, operation, target, sourceSha] = process.argv.slice(2);
if (process.argv.length !== 6) fail('usage: validate-request.mjs REPOSITORY OPERATION TARGET SOURCE_SHA');
if (!['probe', 'status', 'preflight', 'deploy', 'smoke', 'rollback'].includes(operation)) {
  fail('unsupported Listen delivery operation');
}
if (!['staging', 'production'].includes(target)) fail('unsupported Listen delivery target');
if (!/^[0-9a-f]{40}$/.test(sourceSha ?? '')) fail('source SHA must be an exact lowercase sha40');

const git = (...args) => {
  try {
    return execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
};

if (git('cat-file', '-e', `${sourceSha}^{commit}`) === null) fail('foreign source SHA is not a local commit');
const laneHead = git('rev-parse', 'refs/remotes/origin/early-birds');
if (!/^[0-9a-f]{40}$/.test(laneHead ?? '')) fail('early-birds remote-tracking head is unavailable');
if (git('merge-base', '--is-ancestor', sourceSha, 'refs/remotes/origin/early-birds') === null) {
  fail('foreign source SHA is outside the early-birds lane');
}
if (sourceSha !== laneHead) fail('stale source SHA is not the exact early-birds head');

process.stdout.write(`${sourceSha}\n`);
