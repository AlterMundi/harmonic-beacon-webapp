import { NextRequest, NextResponse } from 'next/server';

import { effectiveAnalyticsRole, fetchAnalyticsDashboard } from '@/lib/analytics-access';
import { resolveStaffSession } from '@/lib/ops-auth';

export const dynamic = 'force-dynamic';

function filters(request: NextRequest) {
    const values = request.nextUrl.searchParams;
    return {
        start: values.get('start') ?? undefined,
        end: values.get('end') ?? undefined,
        timezone: values.get('timezone') ?? 'UTC',
        environment: values.get('environment') ?? 'production',
        traffic: (values.get('traffic') ?? 'real').split(',').filter(Boolean),
    };
}

function csvCell(value: unknown): string {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows: unknown[]): string {
    const objects = rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
    const columns = [...new Set(objects.flatMap(row => Object.keys(row)))];
    return [columns.map(csvCell).join(','), ...objects.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\n');
}

export async function GET(request: NextRequest) {
    const staff = await resolveStaffSession(request);
    if (!staff) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const role = await effectiveAnalyticsRole(staff);
    if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const dataset = request.nextUrl.searchParams.get('csv');
    const exporting = Boolean(dataset);
    if (exporting && role === 'ANALYTICS_VIEWER') return NextResponse.json({ error: 'export_forbidden' }, { status: 403 });
    try {
        const currentFilters = filters(request);
        const current = await fetchAnalyticsDashboard({ staff, role, filters: currentFilters, export: exporting });
        if (dataset) {
            const rows = current[dataset];
            if (!Array.isArray(rows)) return NextResponse.json({ error: 'unknown_dataset' }, { status: 400 });
            return new NextResponse(csv(rows), {
                headers: {
                    'content-type': 'text/csv; charset=utf-8',
                    'content-disposition': `attachment; filename="hb-analytics-${dataset}.csv"`,
                    'cache-control': 'private, no-store',
                },
            });
        }
        let previous: Record<string, unknown> | null = null;
        if (request.nextUrl.searchParams.get('compare') === 'previous' && currentFilters.start && currentFilters.end) {
            const start = new Date(currentFilters.start);
            const end = new Date(currentFilters.end);
            const duration = end.getTime() - start.getTime();
            previous = await fetchAnalyticsDashboard({
                staff, role, filters: { ...currentFilters, start: new Date(start.getTime() - duration), end: start },
            });
        }
        return NextResponse.json({ current, previous }, { headers: { 'cache-control': 'private, no-store' } });
    } catch {
        return NextResponse.json({ error: 'analytics_unavailable' }, { status: 503 });
    }
}
