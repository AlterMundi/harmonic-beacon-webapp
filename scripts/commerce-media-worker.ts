import { processNextCommerceMediaJob } from '../src/lib/commerce-media-reconciler';
import { writeFileSync } from 'node:fs';

let stopping = false;
let lastProgressAt = Date.now();
let consecutiveFailures = 0;
const WATCHDOG_MS = 30_000;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
    console.info('[commerce-media] Beacon reconciler started');
    const watchdog = setInterval(() => {
        if (Date.now() - lastProgressAt > WATCHDOG_MS) {
            // Docker does not restart a merely unhealthy container. Exiting is
            // intentional: restart policy is the recovery path for a hung DB
            // driver or poll that never settles.
            console.error('[commerce-media] watchdog expired');
            process.exit(1);
        }
    }, 5_000);
    while (!stopping) {
        try {
            const processed = await processNextCommerceMediaJob();
            lastProgressAt = Date.now();
            consecutiveFailures = 0;
            writeFileSync('/tmp/commerce-reconciler-heartbeat', String(Date.now()), 'utf8');
            if (!processed) await wait(2_000);
        } catch {
            lastProgressAt = Date.now();
            consecutiveFailures += 1;
            console.error('[commerce-media] poll failed');
            if (consecutiveFailures >= 6) {
                console.error('[commerce-media] persistent poll failure; restarting');
                process.exit(1);
            }
            await wait(5_000);
        }
    }
    clearInterval(watchdog);
    console.info('[commerce-media] Beacon reconciler stopped');
}

void main();
