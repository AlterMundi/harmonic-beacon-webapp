import { listenerRuntimeBundle, listenerRuntimeFlag } from '@/lib/listener/runtime-env';

import { earlyBirdTestAuthEnabled } from './auth';
import { earlyBirdsEnabled } from './enabled';

const HOSTNAME = /^(?:localhost|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?::[1-9][0-9]{0,4})?$/;

function canonicalHost(value: string): string | null {
    const host = value.trim().toLowerCase();
    if (!HOSTNAME.test(host)) return null;
    const separator = host.lastIndexOf(':');
    if (separator !== -1) {
        const port = Number(host.slice(separator + 1));
        if (!Number.isSafeInteger(port) || port > 65_535) return null;
    }
    return host;
}

function allowedHosts(environment: NodeJS.ProcessEnv): string[] | null {
    let configuration;
    try {
        configuration = listenerRuntimeBundle([
            'STAGING_TEAM_ENTRY_ENABLED',
            'STAGING_TEAM_ENTRY_HOSTS',
        ], environment);
    } catch {
        return null;
    }
    if (!configuration || !listenerRuntimeFlag('STAGING_TEAM_ENTRY_ENABLED', environment)) return null;
    const raw = configuration.STAGING_TEAM_ENTRY_HOSTS;
    const entries = raw.split(',').map((entry) => canonicalHost(entry)).filter(Boolean);
    if (entries.length === 0 || entries.length !== raw.split(',').length) return null;
    return [...new Set(entries)] as string[];
}

/**
 * Server-only staging gate. No secret or allowlist value is returned to a
 * client; callers receive only an availability boolean or a hidden 404.
 */
export function syntheticTeamEntryAllowed(
    input: { headers: Headers; requestProtocol?: string },
    environment: NodeJS.ProcessEnv = process.env,
): boolean {
    if (environment.NODE_ENV !== 'production') return false;
    if (!earlyBirdsEnabled(environment) || !earlyBirdTestAuthEnabled(environment)) return false;
    const host = canonicalHost(input.headers.get('host') ?? '');
    const hosts = allowedHosts(environment);
    if (!host || !hosts?.includes(host)) return false;

    const forwardedProtocol = input.headers.get('x-forwarded-proto');
    const protocol = forwardedProtocol ?? input.requestProtocol ?? '';
    return protocol.trim().toLowerCase().replace(/:$/, '') === 'https';
}
