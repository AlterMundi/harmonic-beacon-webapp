import { NextResponse } from 'next/server';
import packageJson from '../../../../package.json';
import { buildProvenance, HEALTH_SCHEMA_VERSION } from '@/lib/build-provenance';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Liveness probe — the process is up and serving requests. Deliberately does
 * not touch the database; that is what /api/health/ready is for. A load
 * balancer or container platform uses this to decide whether to restart the
 * process, so it must stay green even when the database is unreachable.
 */
export async function GET() {
    return NextResponse.json(
        {
            schemaVersion: HEALTH_SCHEMA_VERSION,
            status: 'ok',
            uptime: process.uptime(),
            version: packageJson.version,
            ...buildProvenance(process.env),
        },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
