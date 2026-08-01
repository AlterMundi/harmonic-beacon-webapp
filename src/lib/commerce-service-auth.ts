import { createHash, timingSafeEqual } from 'node:crypto';

type ServiceKey = { id: string; token: string };

function configuredKeys(env: NodeJS.ProcessEnv = process.env): ServiceKey[] {
    const candidates = [
        {
            id: env.BEACON_COMMERCE_SERVICE_KEY_CURRENT_ID,
            token: env.BEACON_COMMERCE_SERVICE_KEY_CURRENT,
        },
        {
            id: env.BEACON_COMMERCE_SERVICE_KEY_PREVIOUS_ID,
            token: env.BEACON_COMMERCE_SERVICE_KEY_PREVIOUS,
        },
    ];
    return candidates.flatMap(({ id, token }) =>
        id && token && token.length >= 43 ? [{ id, token }] : []);
}

function digest(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
}

export function authorizeCommerceService(
    authorization: string | null,
    keyId: string | null,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (!keyId || !authorization?.startsWith('Bearer ')) return false;
    const presented = authorization.slice('Bearer '.length);
    if (!presented) return false;

    const presentedDigest = digest(presented);
    let authorized = false;
    for (const candidate of configuredKeys(env)) {
        const sameId = candidate.id === keyId;
        const sameToken = timingSafeEqual(presentedDigest, digest(candidate.token));
        // Do not return early: current and previous keys follow the same path.
        authorized = authorized || (sameId && sameToken);
    }
    return authorized;
}
