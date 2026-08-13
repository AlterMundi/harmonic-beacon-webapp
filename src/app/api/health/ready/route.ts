import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redactError } from '@/lib/redact';
import {
    ListenerRuntimeEnvironmentError,
    validateListenerRuntimeEnvironment,
} from '@/lib/listener/runtime-env';
import {
    ListenerLiveWorkbenchConfigurationError,
    validateListenerLiveWorkbenchEnvironment,
} from '@/lib/early-birds/live-workbench';
import { OperationTimeoutError, withTimeout } from '@/lib/with-timeout';
import {
    ListenerWithdrawalConfigurationError,
    listenerWithdrawalConfiguration,
} from '@/lib/listener/consumer-withdrawal';

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
    let listenerRuntimeConfigured = false;
    let listenerWithdrawalConfigured = false;
    try {
        listenerRuntimeConfigured = validateListenerRuntimeEnvironment();
        validateListenerLiveWorkbenchEnvironment();
        listenerWithdrawalConfigured = listenerWithdrawalConfiguration().enabled;
    } catch (error) {
        const diagnostic = error instanceof ListenerRuntimeEnvironmentError ||
            error instanceof ListenerLiveWorkbenchConfigurationError ||
            error instanceof ListenerWithdrawalConfigurationError
            ? error.message
            : 'unexpected validation failure';
        console.error('Listener runtime configuration invalid:', diagnostic);
        return NextResponse.json(
            {
                status: 'error',
                checks: { database: 'unknown', listenerRuntime: 'invalid' },
            },
            { status: 503, headers: NO_STORE_HEADERS },
        );
    }
    try {
        if (listenerWithdrawalConfigured) {
            const tables = await withTimeout(
                prisma.$queryRaw<Array<{ requests: string | null; throttles: string | null }>>`
                    SELECT
                        to_regclass('public.listener_withdrawal_requests')::text AS requests,
                        to_regclass('public.listener_withdrawal_throttles')::text AS throttles
                `,
                DB_CHECK_TIMEOUT_MS,
                'Listener withdrawal schema check',
            );
            if (!tables[0]?.requests || !tables[0]?.throttles) {
                throw new Error('Listener withdrawal schema unavailable');
            }
        }
        await withTimeout(prisma.$queryRaw`SELECT 1`, DB_CHECK_TIMEOUT_MS, 'Database check');
        return NextResponse.json(
            {
                status: 'ok',
                checks: {
                    database: 'ok',
                    ...(listenerRuntimeConfigured ? { listenerRuntime: 'ok' } : {}),
                    ...(listenerWithdrawalConfigured ? { listenerWithdrawal: 'ok' } : {}),
                },
            },
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
