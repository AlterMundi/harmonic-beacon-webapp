#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

function usage(): never {
    console.log(`Usage: npm run stage-grants:rollback-preflight

Read-only fail-closed check before temporarily rolling the application back to
a legacy image. It refuses while a session is LIVE, a durable effect is
pending/processing, or a participant marker remains set.`);
    process.exit(0);
}

async function main(): Promise<void> {
    if (process.argv.includes('--help') || process.argv.includes('-h')) usage();
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
        const [liveSessions, pendingEffects, pendingMarkers] = await Promise.all([
            prisma.scheduledSession.count({ where: { status: 'LIVE' } }),
            prisma.stageGrantEffectOutbox.count({
                where: { status: { in: ['PENDING', 'PROCESSING'] } },
            }),
            prisma.sessionParticipant.count({ where: { grantReconcileNeeded: true } }),
        ]);
        const report = { liveSessions, pendingEffects, pendingMarkers };
        if (liveSessions || pendingEffects || pendingMarkers) {
            console.error(JSON.stringify({ safe: false, ...report }));
            process.exitCode = 2;
            return;
        }
        console.log(JSON.stringify({ safe: true, ...report }));
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Rollback preflight failed');
    process.exitCode = 1;
});
