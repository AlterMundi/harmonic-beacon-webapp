import type { GlobalNavigationSurface } from '@/components/brand/GlobalNavigation';

export type GlobalNavigationAccountHref =
    | 'https://account.harmonicbeacon.com/account'
    | 'https://account-staging.harmonicbeacon.com/account';

const PUBLIC_SURFACES: Record<string, GlobalNavigationSurface> = {
    'live.harmonicbeacon.com': 'events',
    'live-staging.harmonicbeacon.com': 'events',
    'listen.harmonicbeacon.com': 'listen',
    'earlybirds-staging.harmonicbeacon.com': 'listen',
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

/** Keep every staging product inside the staging identity boundary, including
 * the server-rendered fallback shown before the pinned asset initializes. */
export function globalNavigationAccountHref(
    headers: Pick<Headers, 'get'>,
): GlobalNavigationAccountHref {
    const host = normalizedHost(headers.get('host'));
    return host === 'earlybirds-staging.harmonicbeacon.com' ||
        host === 'live-staging.harmonicbeacon.com' ||
        host === 'account-staging.harmonicbeacon.com'
        ? 'https://account-staging.harmonicbeacon.com/account'
        : 'https://account.harmonicbeacon.com/account';
}
