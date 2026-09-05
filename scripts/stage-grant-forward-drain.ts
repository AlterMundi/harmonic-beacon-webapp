#!/usr/bin/env tsx

import { config } from 'dotenv';

import { prisma } from '../src/lib/db';
import {
    processNextStageGrantEffect,
    repairNextUncoveredGrantEffect,
} from '../src/lib/stage-grant-effects';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const MAX_STEPS = 10_000;

async function main(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    try {
        for (let step = 1; step <= MAX_STEPS; step += 1) {
            const repaired = await repairNextUncoveredGrantEffect();
            const processed = await processNextStageGrantEffect();
            const pendingMarkers = await prisma.sessionParticipant.count({
                where: { grantReconcileNeeded: true },
            });
            if (pendingMarkers === 0) {
                console.log(JSON.stringify({ safe: true, steps: step }));
                return;
            }
            if (!repaired && !processed) {
                throw new Error(`stage grant drain stalled with ${pendingMarkers} markers`);
            }
        }
        throw new Error(`stage grant drain exceeded ${MAX_STEPS} steps`);
    } finally {
        await prisma.$disconnect();
    }
}

void main().catch(() => {
    console.error('Stage grant forward drain failed');
    process.exitCode = 1;
});
