import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    evaluateProductionAudit,
    type InstalledAuditPackage,
    type InstalledAuditPackages,
} from '../src/lib/production-audit-guard';

function readInstalledPackage(relativePath: string): InstalledAuditPackage {
    const packagePath = path.join(process.cwd(), relativePath, 'package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        version?: unknown;
        dependencies?: unknown;
    };

    if (typeof parsed.version !== 'string') {
        throw new Error(`Missing package version at ${relativePath}`);
    }

    const dependencies = parsed.dependencies ?? {};
    if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) {
        throw new Error(`Missing dependency map at ${relativePath}`);
    }

    return {
        version: parsed.version,
        dependencies: dependencies as Record<string, string>,
    };
}

function readInstalledPackages(): InstalledAuditPackages {
    return {
        prisma: readInstalledPackage('node_modules/prisma'),
        '@prisma/config': readInstalledPackage('node_modules/@prisma/config'),
        'deepmerge-ts': readInstalledPackage('node_modules/deepmerge-ts'),
    };
}

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

let installed: InstalledAuditPackages | undefined;
try {
    installed = readInstalledPackages();
} catch {
    installed = undefined;
}

const decision = evaluateProductionAudit(report, installed);
const log = decision.ok ? console.log : console.error;
log(decision.message);
process.exit(decision.ok ? 0 : 1);
