import { createHmac, randomUUID } from 'node:crypto';

type AnalyticsSurface = 'account' | 'listen' | 'commerce';
type AnalyticsSource = 'account' | 'listener' | 'membership';

type AnalyticsEnvironment = 'production' | 'staging' | 'development' | 'test';

function environment(explicit?: AnalyticsEnvironment): AnalyticsEnvironment {
    if (explicit) return explicit;
    const value: string | undefined = process.env.NODE_ENV;
    if (value === 'production' || value === 'staging' || value === 'test') return value;
    return 'development';
}

export function analyticsAccountSubject(accountId: string): string | null {
    const secret = process.env.ANALYTICS_IDENTITY_SECRET?.trim();
    if (!secret || secret.length < 32) return null;
    return createHmac('sha256', secret).update(`account\0${accountId}`).digest('hex');
}

export async function emitAnalyticsEvent(input: {
    eventName: string;
    source: AnalyticsSource;
    surface: AnalyticsSurface;
    accountId?: string;
    visitorId?: string;
    sessionId?: string;
    occurredAt?: Date;
    trafficClass?: 'real' | 'internal' | 'synthetic' | 'test' | 'unknown';
    properties?: Record<string, string | number | boolean | null>;
    environment?: AnalyticsEnvironment;
}): Promise<boolean> {
    const endpoint = process.env.ANALYTICS_INTERNAL_URL?.trim();
    const secret = process.env.ANALYTICS_SERVER_EVENT_SECRET?.trim();
    if (!endpoint || !secret || secret.length < 32) return false;
    const body = JSON.stringify({
        schema_version: 'hb.analytics.event.v1',
        event_id: randomUUID(),
        event_name: input.eventName,
        occurred_at: (input.occurredAt ?? new Date()).toISOString(),
        source: input.source,
        surface: input.surface,
        environment: environment(input.environment),
        account_subject: input.accountId ? analyticsAccountSubject(input.accountId) : null,
        visitor_id: input.visitorId ?? null,
        session_id: input.sessionId ?? null,
        traffic_class: input.trafficClass ?? 'unknown',
        properties: input.properties ?? {},
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    try {
        const response = await fetch(`${endpoint.replace(/\/$/, '')}/v1/server-events`, {
            method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(1_500),
            headers: {
                'content-type': 'application/json',
                'x-hb-event-timestamp': timestamp,
                'x-hb-event-signature': signature,
            },
            body,
        });
        return response.status === 202;
    } catch { return false; }
}
