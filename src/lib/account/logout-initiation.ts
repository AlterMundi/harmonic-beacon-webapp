import {
    accountOrigin,
    accountStaticClientSecrets,
    activeAccountStaticClients,
} from '@/lib/account/config';
import { verifyAccountLogoutInitiation } from '@/lib/account/frontchannel-token';

function untrustedClientId(token: string): string | null {
    try {
        const encoded = token.split('.', 1)[0];
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
            client_id?: unknown;
        };
        return typeof payload.client_id === 'string' ? payload.client_id : null;
    } catch { return null; }
}

export function accountLogoutInitiationValid(input: {
    token: string | undefined;
    sid: string;
    mode: 'current' | 'all';
}): boolean {
    // Same-origin Account UI actions are explicit user gestures and need no RP
    // initiation. Automatic cross-product logout must present the signed token.
    if (input.token === undefined) return true;
    const clientId = untrustedClientId(input.token);
    const definition = clientId && activeAccountStaticClients()
        .find((client) => client.clientId === clientId);
    const secret = definition && accountStaticClientSecrets()
        .find((client) => client.clientId === definition.clientId)?.clientSecret;
    if (!definition || !secret) return false;
    return verifyAccountLogoutInitiation({
        token: input.token, issuer: accountOrigin(), clientId: definition.clientId,
        clientSecret: secret, sid: input.sid, mode: input.mode,
        returnTo: `${new URL(definition.redirectUri).origin}/`,
    });
}
