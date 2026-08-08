import { createHash, timingSafeEqual } from 'node:crypto';

type ServiceKey = { id: string; token: string };

function configuredKeys(env: NodeJS.ProcessEnv): ServiceKey[] {
    return [
        {
            id: env.EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT_ID,
            token: env.EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT,
        },
        {
            id: env.EARLY_BIRDS_BEACON_SERVICE_KEY_PREVIOUS_ID,
            token: env.EARLY_BIRDS_BEACON_SERVICE_KEY_PREVIOUS,
        },
    ].flatMap(({ id, token }) => id && token && token.length >= 43 ? [{ id, token }] : []);
}

function digest(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
}

export function authorizeEarlyBirdMembershipService(
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
        authorized = authorized || (sameId && sameToken);
    }
    return authorized;
}
