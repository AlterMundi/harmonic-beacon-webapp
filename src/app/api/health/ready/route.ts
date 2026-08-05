import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redactError } from '@/lib/redact';
import { OperationTimeoutError, withTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

const DB_CHECK_TIMEOUT_MS = 3000;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/**
 * GET /api/health/ready
 * Readiness probe — verifies the database is reachable with a trivial query,
 * bounded by a short timeout so a hung database can't hang the probe. Used
 * by a load balancer to decide whether to route traffic to this replica.
 * Public and unauthenticated, so failures never leak connection details: the
 * body distinguishes only 'timeout' from 'unreachable', nothing more.
 */
export async function GET() {
    try {
        await withTimeout(prisma.$queryRaw`SELECT 1`, DB_CHECK_TIMEOUT_MS, 'Database check');
        return NextResponse.json(
            { status: 'ok', checks: { database: 'ok' } },
            { headers: NO_STORE_HEADERS },
        );
    } catch (error) {
        // Redacted: a pg auth failure carries the full connection string,
        // password included, in error.message — and stdout is shipped to a
        // log aggregator in the cloud deploy.
        console.error('Readiness check failed:', redactError(error));
        return NextResponse.json(
            {
                status: 'error',
                checks: {
                    database:
                        error instanceof OperationTimeoutError ? 'timeout' : 'unreachable',
                },
            },
            { status: 503, headers: NO_STORE_HEADERS },
        );
    }
}
