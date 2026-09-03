import { NextRequest, NextResponse } from 'next/server';

import { effectiveAnalyticsRole, fetchAnalyticsDashboard } from '@/lib/analytics-access';
import {
    previousCalendarRange, validateAnalyticsCalendarSelection, validateAnalyticsTimezone,
} from '@/lib/analytics-calendar-range';
import { analyticsCsv } from '@/lib/analytics-csv';
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
        let comparison: { start: string; end: string } | null = null;
        try {
            validateAnalyticsTimezone(currentFilters.timezone);
        } catch {
            return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 });
        }
        if (currentFilters.start || currentFilters.end) {
            if (!currentFilters.start || !currentFilters.end) {
                return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 });
            }
            try {
                validateAnalyticsCalendarSelection(currentFilters.start, currentFilters.end, currentFilters.timezone);
                comparison = previousCalendarRange(currentFilters.start, currentFilters.end);
            } catch {
                return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 });
            }
        }
        const current = await fetchAnalyticsDashboard({ staff, role, filters: currentFilters, export: exporting });
        if (dataset) {
            const rows = current[dataset];
            if (!Array.isArray(rows)) return NextResponse.json({ error: 'unknown_dataset' }, { status: 400 });
            return new NextResponse(analyticsCsv(rows), {
                headers: {
                    'content-type': 'text/csv; charset=utf-8',
                    'content-disposition': `attachment; filename="hb-analytics-${dataset}.csv"`,
                    'cache-control': 'private, no-store',
                },
            });
        }
        let previous: Record<string, unknown> | null = null;
        if (request.nextUrl.searchParams.get('compare') === 'previous' && comparison) {
            previous = await fetchAnalyticsDashboard({
                staff, role, filters: { ...currentFilters, ...comparison },
            });
        }
        return NextResponse.json({ current, previous }, { headers: { 'cache-control': 'private, no-store' } });
    } catch {
        return NextResponse.json({ error: 'analytics_unavailable' }, { status: 503 });
    }
}
