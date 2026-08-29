const COLLECTOR = 'https://live.harmonicbeacon.com/_a';

const HOSTS: Record<string, { surface: 'live'; environment: 'production' | 'staging' }> = {
    'live.harmonicbeacon.com': { surface: 'live', environment: 'production' },
    'live-staging.harmonicbeacon.com': { surface: 'live', environment: 'staging' },
};

export function analyticsBrowserConfig(headers: Pick<Headers, 'get'>) {
    const host = headers.get('host')?.trim().toLowerCase().split(':', 1)[0] ?? '';
    const target = HOSTS[host];
    return target ? { collector: COLLECTOR, ...target } : null;
}
