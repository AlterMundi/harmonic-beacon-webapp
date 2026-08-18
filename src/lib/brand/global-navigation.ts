import type { GlobalNavigationSurface } from '@/components/brand/GlobalNavigation';

const PUBLIC_SURFACES: Record<string, GlobalNavigationSurface> = {
    'live.harmonicbeacon.com': 'events',
    'listen.harmonicbeacon.com': 'listen',
    'earlybirds-staging.harmonicbeacon.com': 'listen',
    'account.harmonicbeacon.com': 'account',
    'account-staging.harmonicbeacon.com': 'account',
};

function normalizedHost(value: string | null): string | null {
    const candidate = value?.trim().toLowerCase();
    if (!candidate) return null;
    const authority = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(candidate);
    if (!authority) return null;
    if (authority[2] && Number(authority[2]) > 65_535) return null;
    return authority[1];
}

export function globalNavigationSurface(headers: Pick<Headers, 'get'>): GlobalNavigationSurface | null {
    const host = normalizedHost(headers.get('host'));
    return host ? (PUBLIC_SURFACES[host] ?? null) : null;
}
