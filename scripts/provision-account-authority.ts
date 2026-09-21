import { randomUUID } from 'node:crypto';

import { prisma } from '../src/lib/db';
import {
    accountOrigin,
    accountStaticClientSecrets,
    activeAccountStaticClients,
} from '../src/lib/account/config';
import { hashAccountClientSecret } from '../src/lib/account/client-secret';
import { accountAuth } from '../src/lib/account/auth';

async function main() {
    const issuer = accountOrigin();
    if (process.env.BEACON_ACCOUNT_PROVISION_CONFIRM_ISSUER !== issuer) {
        throw new Error('BEACON_ACCOUNT_PROVISION_CONFIRM_ISSUER must exactly match the configured issuer');
    }
    const configured = new Map(accountStaticClientSecrets().map((client) => [client.clientId, client]));
    const active = activeAccountStaticClients();
    for (const client of active) {
        const secret = configured.get(client.clientId)?.clientSecret;
        if (!secret || secret.length < 32) throw new Error(`${client.secretVariable} is missing or too short`);
    }
    await prisma.$transaction(async (transaction) => {
        const marker = await transaction.beaconAccountAuthorityEnvironment.findUnique({
            where: { id: 'authority' }, select: { issuer: true },
        });
        if (marker && marker.issuer !== issuer) {
            throw new Error('Refusing to provision an Account database claimed by another issuer');
        }
        if (!marker) await transaction.beaconAccountAuthorityEnvironment.create({
            data: { id: 'authority', issuer },
        });
        for (const client of active) {
            const secret = configured.get(client.clientId)!.clientSecret!;
            await transaction.beaconOAuthClient.upsert({
                where: { clientId: client.clientId },
                create: {
                    id: randomUUID(),
                    clientId: client.clientId,
                    clientSecret: hashAccountClientSecret(secret),
                    disabled: false,
                    skipConsent: true,
                    enableEndSession: true,
                    subjectType: 'public',
                    scopes: ['openid', 'profile', 'email'],
                    name: client.clientId,
                    redirectUris: [client.redirectUri],
                    postLogoutRedirectUris: [client.postLogoutRedirectUri],
                    tokenEndpointAuthMethod: 'client_secret_basic',
                    grantTypes: ['authorization_code'],
                    responseTypes: ['code'],
                    public: false,
                    type: 'web',
                    requirePKCE: true,
                    contacts: [],
                },
                update: {
                    clientSecret: hashAccountClientSecret(secret),
                    disabled: false,
                    skipConsent: true,
                    enableEndSession: true,
                    subjectType: 'public',
                    scopes: ['openid', 'profile', 'email'],
                    redirectUris: [client.redirectUri],
                    postLogoutRedirectUris: [client.postLogoutRedirectUri],
                    tokenEndpointAuthMethod: 'client_secret_basic',
                    grantTypes: ['authorization_code'],
                    responseTypes: ['code'],
                    public: false,
                    type: 'web',
                    requirePKCE: true,
                },
            });
        }
        await transaction.beaconOAuthClient.updateMany({
            where: { clientId: { notIn: active.map((client) => client.clientId) } },
            data: { disabled: true },
        });
    });
    await accountAuth().api.getJwks();
    process.stdout.write(`Account authority provisioned for ${issuer}; ${active.length} static clients active.\n`);
}

main().finally(() => prisma.$disconnect()).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Account provisioning failed'}\n`);
    process.exitCode = 1;
});
