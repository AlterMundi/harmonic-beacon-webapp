type PublicLiveKitEnvironment = {
    NODE_ENV?: string;
    LIVEKIT_PUBLIC_URL?: string;
    LIVEKIT_PUBLIC_URL_ALLOWLIST?: string;
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseEndpoint(value: string, name: string): URL {
    let endpoint: URL;
    try {
        endpoint = new URL(value);
    } catch {
        throw new Error(`${name} must be an absolute websocket URL`);
    }
    if (!['ws:', 'wss:'].includes(endpoint.protocol)) {
        throw new Error(`${name} must use ws or wss`);
    }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new Error(`${name} must not contain credentials, query, or fragment`);
    }
    return endpoint;
}

/**
 * Resolve the browser signaling endpoint at request time. The complete URL,
 * including its path, must be present in the environment-specific allowlist;
 * host suffixes and path prefixes are never accepted implicitly.
 */
export function resolveLiveKitPublicUrl(
    env: PublicLiveKitEnvironment = process.env,
): string {
    const configured = env.LIVEKIT_PUBLIC_URL?.trim();
    if (!configured) throw new Error('LIVEKIT_PUBLIC_URL is required');

    const allowlist = env.LIVEKIT_PUBLIC_URL_ALLOWLIST
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (!allowlist?.length) {
        throw new Error('LIVEKIT_PUBLIC_URL_ALLOWLIST is required');
    }

    const endpoint = parseEndpoint(configured, 'LIVEKIT_PUBLIC_URL');
    const production = env.NODE_ENV === 'production';
    if (production && endpoint.protocol !== 'wss:') {
        throw new Error('LIVEKIT_PUBLIC_URL must use wss in production');
    }
    if (!production && endpoint.protocol === 'ws:' && !LOOPBACK_HOSTS.has(endpoint.hostname)) {
        throw new Error('LIVEKIT_PUBLIC_URL ws endpoints must be loopback outside production');
    }

    const allowed = allowlist.map((entry) =>
        parseEndpoint(entry, 'LIVEKIT_PUBLIC_URL_ALLOWLIST').href,
    );
    if (!allowed.includes(endpoint.href)) {
        throw new Error('LIVEKIT_PUBLIC_URL is not in LIVEKIT_PUBLIC_URL_ALLOWLIST');
    }
    return endpoint.href;
}
