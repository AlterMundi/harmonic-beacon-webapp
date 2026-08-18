import { rename, writeFile } from 'node:fs/promises';

import { prisma } from '../src/lib/db';
import { assertAccountAuthorityDatabase } from '../src/lib/account/authority-db';
import {
    accountMailOutboxMetrics,
    processAccountMailOutboxBatch,
} from '../src/lib/account/mail-outbox';
import { cleanupAccountAuthorityRecords } from '../src/lib/account/maintenance';
import {
    accountMaintenanceDue,
    accountWorkerStatus,
    initialAccountMaintenanceState,
    recordAccountMaintenanceAttempt,
} from '../src/lib/account/worker-health';

const WATCH = process.argv.includes('--watch');
const HEARTBEAT = process.env.BEACON_ACCOUNT_MAIL_WORKER_HEARTBEAT_FILE?.trim() ||
    '/tmp/beacon-account-mail-worker-heartbeat';
let stopping = false;
let consecutiveErrors = 0;
let lastSuccessAt: string | null = null;
let maintenanceState = initialAccountMaintenanceState();
process.once('SIGTERM', () => { stopping = true; });
process.once('SIGINT', () => { stopping = true; });

async function heartbeat(delivered: number) {
    const metrics = await accountMailOutboxMetrics();
    const status = accountWorkerStatus(consecutiveErrors, maintenanceState);
    const temporary = `${HEARTBEAT}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({
        status, at: new Date().toISOString(), delivered,
        gitSha: process.env.BEACON_GIT_SHA ?? 'unknown',
        ...metrics,
        consecutiveErrors,
        maintenanceStatus: maintenanceState.failed ? 'error' : 'ok',
        lastSuccessAt,
    }), { mode: 0o600 });
    await rename(temporary, HEARTBEAT);
}

async function once() {
    await assertAccountAuthorityDatabase();
    const now = Date.now();
    if (accountMaintenanceDue(maintenanceState, now)) {
        try {
            await cleanupAccountAuthorityRecords();
            maintenanceState = recordAccountMaintenanceAttempt(maintenanceState, now, true);
        } catch {
            maintenanceState = recordAccountMaintenanceAttempt(maintenanceState, now, false);
        }
    }
    const batch = await processAccountMailOutboxBatch(50);
    if (batch.failed > 0) consecutiveErrors += 1;
    else if (batch.attempted > 0 || (await accountMailOutboxMetrics()).pendingCount === 0) {
        consecutiveErrors = 0;
        lastSuccessAt = new Date().toISOString();
    }
    await heartbeat(batch.delivered);
    return { ...batch, maintenanceFailed: maintenanceState.failed };
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
