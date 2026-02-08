// Prisma client singleton for Next.js
// Prevents multiple instances in development due to hot reloading
// Updated for Prisma 7 with PostgreSQL adapter

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
    pool: Pool | undefined;
};

function createPrismaClient() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL environment variable is not set');
    }

    // Prisma 7 requires adapter for all connections
    const pool = globalForPrisma.pool ?? new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10, // Connection pool size
    });

    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.pool = pool;
    }

    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

export default prisma;
