import { spawnSync } from 'node:child_process';

import { evaluateProductionAudit } from '../src/lib/production-audit-guard';

const audit = spawnSync(
    'npm',
    ['audit', '--omit=dev', '--audit-level=high', '--json'],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);

if (audit.error || audit.signal || (audit.status !== 0 && audit.status !== 1)) {
    console.error(`Production dependency audit could not complete (status ${audit.status ?? 'unknown'}).`);
    process.exit(1);
}

let report: unknown;
try {
    report = JSON.parse(audit.stdout);
} catch {
    console.error('Production dependency audit returned invalid JSON.');
    process.exit(1);
}

const decision = evaluateProductionAudit(report);
const log = decision.ok ? console.log : console.error;
log(decision.message);
process.exit(decision.ok ? 0 : 1);
