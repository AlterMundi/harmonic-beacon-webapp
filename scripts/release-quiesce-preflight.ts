#!/usr/bin/env tsx

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

async function main(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
        const liveSessions = await prisma.scheduledSession.count({
            where: { status: 'LIVE' },
        });
        if (liveSessions !== 0) {
            console.error(JSON.stringify({ safe: false, liveSessions }));
            process.exitCode = 2;
            return;
        }
        console.log(JSON.stringify({ safe: true, liveSessions }));
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

void main().catch(() => {
    console.error('Release quiesce preflight failed');
    process.exitCode = 1;
});
