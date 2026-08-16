import { prisma } from '@/lib/db';
import { quiescePersonalListenerLeasesForFreeForAll } from '@/lib/early-birds/stream';

const BATCH_SIZE = 1_000;
const MAX_BATCHES = 100;

async function main() {
    if (process.env.EARLY_BIRDS_ENABLED !== '0' || process.env.EARLY_BIRDS_FREE_FOR_ALL !== '0') {
        throw new Error('Disable Listener public entry and keep Free For All OFF before quiescing leases');
    }

    let totalSettled = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const result = await quiescePersonalListenerLeasesForFreeForAll(BATCH_SIZE);
        totalSettled += result.accountsSettled;
        if (result.accountsSettled === 0) {
            console.info(`Listener personal leases quiesced; accounts settled: ${totalSettled}`);
            return;
        }
    }
    throw new Error('Listener lease quiescence did not converge within the bounded batch limit');
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : 'Listener lease quiescence failed');
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
