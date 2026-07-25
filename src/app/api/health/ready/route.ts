import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redactError } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const DB_CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Database check timed out')), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

/**
 * GET /api/health/ready
 * Readiness probe — verifies the database is reachable with a trivial query,
 * bounded by a short timeout so a hung database can't hang the probe. Used
 * by a load balancer to decide whether to route traffic to this replica.
 * Public and unauthenticated, so failures never leak connection details.
 */
export async function GET() {
    try {
        await withTimeout(prisma.$queryRaw`SELECT 1`, DB_CHECK_TIMEOUT_MS);
        return NextResponse.json({ status: 'ok', checks: { database: 'ok' } });
    } catch (error) {
        // Redacted: a pg auth failure carries the full connection string,
        // password included, in error.message — and stdout is shipped to a
        // log aggregator in the cloud deploy.
        console.error('Readiness check failed:', redactError(error));
        return NextResponse.json(
            { status: 'error', checks: { database: 'unreachable' } },
            { status: 503 },
        );
    }
}
