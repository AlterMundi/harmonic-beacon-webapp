export type LiveKitTokenResponse = {
    token: string;
    livekitUrl: string;
};

/** Fail closed before handing runtime token/configuration data to the SDK. */
export function parseLiveKitTokenResponse(value: unknown): LiveKitTokenResponse {
    if (!value || typeof value !== 'object') {
        throw new Error('invalid LiveKit token response');
    }
    const { token, livekitUrl } = value as Record<string, unknown>;
    if (typeof token !== 'string' || !token.trim() || typeof livekitUrl !== 'string') {
        throw new Error('invalid LiveKit token response');
    }

    let endpoint: URL;
    try {
        endpoint = new URL(livekitUrl);
    } catch {
        throw new Error('invalid LiveKit token response');
    }
    const localWebsocket = endpoint.protocol === 'ws:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if ((endpoint.protocol !== 'wss:' && !localWebsocket) ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new Error('invalid LiveKit token response');
    }

    return { token, livekitUrl: endpoint.href };
}
