import { createHmac } from 'node:crypto';

import { prisma } from '@/lib/db';
import type { StaffPrincipal } from '@/lib/ops-auth';

export type EffectiveAnalyticsRole = 'ADMIN' | 'ANALYTICS_VIEWER' | 'ANALYTICS_EXPORTER';

export async function effectiveAnalyticsRole(staff: StaffPrincipal): Promise<EffectiveAnalyticsRole | null> {
    if (staff.role === 'ADMIN') return 'ADMIN';
    const delegate = (prisma as unknown as { analyticsRoleGrant?: {
        findUnique(args: unknown): Promise<{ role: 'VIEWER' | 'EXPORTER'; revokedAt: Date | null } | null>;
    } }).analyticsRoleGrant;
    if (!delegate) return null;
    const grant = await delegate.findUnique({ where: { staffUserId: staff.id } });
    if (!grant || grant.revokedAt) return null;
    return grant.role === 'EXPORTER' ? 'ANALYTICS_EXPORTER' : 'ANALYTICS_VIEWER';
}

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

export async function fetchAnalyticsDashboard(input: {
    staff: StaffPrincipal;
    role: EffectiveAnalyticsRole;
    filters: Record<string, unknown>;
    export?: boolean;
}): Promise<Record<string, unknown>> {
    const secret = required('ANALYTICS_SERVER_EVENT_SECRET');
    const identitySecret = required('ANALYTICS_IDENTITY_SECRET');
    const body = JSON.stringify({
        actor_subject: createHmac('sha256', identitySecret).update(`staff\0${input.staff.id}`).digest('hex'),
        actor_role: input.role,
        filters: input.filters,
        export: input.export === true,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const response = await fetch(`${required('ANALYTICS_INTERNAL_URL').replace(/\/$/, '')}/v1/admin/dashboard`, {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10_000),
        headers: {
            'content-type': 'application/json',
            'x-hb-event-timestamp': timestamp,
            'x-hb-event-signature': signature,
        },
        body,
    });
    if (!response.ok) throw new Error(`analytics_http_${response.status}`);
    return response.json() as Promise<Record<string, unknown>>;
}
