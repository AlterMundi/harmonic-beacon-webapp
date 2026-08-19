import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redactError } from '@/lib/redact';
import { OperationTimeoutError, withTimeout } from '@/lib/with-timeout';
import { beaconAccountEnabled, discoverAccountIssuer } from '@/lib/account-rp';

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
        let account: 'disabled' | 'ok' | 'unavailable' = 'disabled';
        if (beaconAccountEnabled()) {
            try {
                await withTimeout(discoverAccountIssuer(), DB_CHECK_TIMEOUT_MS, 'Account discovery');
                account = 'ok';
            } catch (error) {
                // Account outage fails closed at each new auth/protected
                // transition, but must not make the app unready and tear down
                // already-issued LiveKit/media sessions.
                account = 'unavailable';
                console.error('Account readiness check failed:', redactError(error));
            }
        }
        return NextResponse.json(
            { status: 'ok', checks: { database: 'ok', account } },
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
