import { rename, writeFile } from 'node:fs/promises';

import { prisma } from '../src/lib/db';
import { assertAccountAuthorityDatabase } from '../src/lib/account/authority-db';
import {
    accountMailOutboxMetrics,
    processAccountMailOutboxBatch,
} from '../src/lib/account/mail-outbox';
import { cleanupAccountAuthorityRecords } from '../src/lib/account/maintenance';

const WATCH = process.argv.includes('--watch');
const HEARTBEAT = process.env.BEACON_ACCOUNT_MAIL_WORKER_HEARTBEAT_FILE?.trim() ||
    '/tmp/beacon-account-mail-worker-heartbeat';
let stopping = false;
let consecutiveErrors = 0;
let lastSuccessAt: string | null = null;
let lastMaintenanceAt = 0;
const MAINTENANCE_INTERVAL_MS = 15 * 60_000;
process.once('SIGTERM', () => { stopping = true; });
process.once('SIGINT', () => { stopping = true; });

async function heartbeat(delivered: number) {
    const metrics = await accountMailOutboxMetrics();
    const status = consecutiveErrors >= 3 ? 'error' : consecutiveErrors > 0 ? 'degraded' : 'ok';
    const temporary = `${HEARTBEAT}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({
        status, at: new Date().toISOString(), delivered,
        gitSha: process.env.BEACON_GIT_SHA ?? 'unknown',
        ...metrics,
        consecutiveErrors,
        lastSuccessAt,
    }), { mode: 0o600 });
    await rename(temporary, HEARTBEAT);
}

async function once() {
    await assertAccountAuthorityDatabase();
    let maintenanceFailed = false;
    if (Date.now() - lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS) {
        lastMaintenanceAt = Date.now();
        try { await cleanupAccountAuthorityRecords(); }
        catch { maintenanceFailed = true; }
    }
    const batch = await processAccountMailOutboxBatch(50);
    if (batch.failed > 0 || maintenanceFailed) consecutiveErrors += 1;
    else if (batch.attempted > 0 || (await accountMailOutboxMetrics()).pendingCount === 0) {
        consecutiveErrors = 0;
        lastSuccessAt = new Date().toISOString();
    }
    await heartbeat(batch.delivered);
    return { ...batch, maintenanceFailed };
}

async function main() {
    if (!WATCH) {
        const batch = await once();
        process.stdout.write(`Account mail batch attempted=${batch.attempted} delivered=${batch.delivered} failed=${batch.failed}\n`);
        if (batch.failed > 0 || batch.maintenanceFailed) process.exitCode = 1;
        return;
    }
    let backoff = 1_000;
    while (!stopping) {
        try {
            await once();
            backoff = 1_000;
            await new Promise((resolve) => setTimeout(resolve, 5_000));
        } catch {
            await new Promise((resolve) => setTimeout(resolve, backoff));
            backoff = Math.min(backoff * 2, 30_000);
        }
    }
}

main().finally(() => prisma.$disconnect()).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Account mail outbox failed'}\n`);
    process.exitCode = 1;
});
