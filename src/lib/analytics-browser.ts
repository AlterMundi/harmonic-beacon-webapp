const COLLECTOR = 'https://live.harmonicbeacon.com/_a';

type BrowserAnalyticsTarget = {
    surface: 'account' | 'listen';
    environment: 'production' | 'staging';
};

const HOSTS: Record<string, BrowserAnalyticsTarget> = {
    'account.harmonicbeacon.com': { surface: 'account', environment: 'production' },
    'account-staging.harmonicbeacon.com': { surface: 'account', environment: 'staging' },
    'listen.harmonicbeacon.com': { surface: 'listen', environment: 'production' },
    'earlybirds-staging.harmonicbeacon.com': { surface: 'listen', environment: 'staging' },
};

export function analyticsBrowserConfig(headers: Pick<Headers, 'get'>) {
    const host = headers.get('host')?.trim().toLowerCase().split(':', 1)[0] ?? '';
    const target = HOSTS[host];
    return target ? { collector: COLLECTOR, ...target } : null;
}
