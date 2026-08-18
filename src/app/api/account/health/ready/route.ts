import { prisma } from '@/lib/db';
import { accountAuthorityDatabaseReady } from '@/lib/account/authority-db';
import {
    accountRateSecret,
    accountSecret,
    accountSocialProviderConfiguration,
    accountStaticClientSecrets,
    activeAccountStaticClients,
    isAccountHost,
} from '@/lib/account/config';
import { hashAccountClientSecret } from '@/lib/account/client-secret';
import { accountMailReady } from '@/lib/account/mail';
import { accountMailOutboxReady } from '@/lib/account/mail-outbox';

export async function GET(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    const checks: Record<string, boolean> = {
        runtime: process.env.BEACON_ACCOUNT_RUNTIME === '1',
        authSecret: false,
        rateSecret: accountRateSecret() !== null,
        mail: accountMailReady() && accountMailOutboxReady(),
        databaseIssuer: await accountAuthorityDatabaseReady(),
        clients: false,
        jwks: false,
        providers: false,
    };
    try { checks.authSecret = accountSecret().length >= 32; } catch { checks.authSecret = false; }
    try {
        accountSocialProviderConfiguration();
        checks.providers = true;
    } catch { checks.providers = false; }
    try {
        const configured = new Map(accountStaticClientSecrets().map((client) => [client.clientId, client.clientSecret]));
        const expected = activeAccountStaticClients();
        const persisted = await prisma.beaconOAuthClient.findMany({
            where: { disabled: false },
            select: {
                clientId: true, clientSecret: true, redirectUris: true,
                postLogoutRedirectUris: true, disabled: true, skipConsent: true,
                enableEndSession: true, subjectType: true, type: true, public: true,
                requirePKCE: true, tokenEndpointAuthMethod: true,
                grantTypes: true, responseTypes: true, scopes: true,
            },
        });
        checks.clients = persisted.length === expected.length && expected.every((client) => {
            const row = persisted.find((candidate) => candidate.clientId === client.clientId);
            const secret = configured.get(client.clientId);
            return Boolean(row && secret && row.clientSecret === hashAccountClientSecret(secret) &&
                row.disabled === false && row.skipConsent === true && row.enableEndSession === true &&
                row.subjectType === 'public' && row.type === 'web' && row.public === false &&
                row.requirePKCE === true && row.tokenEndpointAuthMethod === 'client_secret_basic' &&
                row.grantTypes.length === 1 && row.grantTypes[0] === 'authorization_code' &&
                row.responseTypes.length === 1 && row.responseTypes[0] === 'code' &&
                row.scopes.length === 2 && row.scopes[0] === 'openid' && row.scopes[1] === 'profile' &&
                row.redirectUris.length === 1 && row.redirectUris[0] === client.redirectUri &&
                row.postLogoutRedirectUris.length === 1 &&
                row.postLogoutRedirectUris[0] === client.postLogoutRedirectUri);
        });
        checks.jwks = await prisma.beaconJwks.count({ where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        } }) > 0;
    } catch { checks.clients = false; checks.jwks = false; }
    const ready = Object.values(checks).every(Boolean);
    const publicChecks = {
        database: checks.databaseIssuer ? 'ok' : 'error',
        mail: checks.mail ? 'ok' : 'error',
        issuer: checks.runtime && checks.authSecret && checks.rateSecret ? 'ok' : 'error',
        jwks: checks.jwks ? 'ok' : 'error',
        clients: checks.clients ? 'ok' : 'error',
        providers: checks.providers ? 'ok' : 'error',
    };
    return Response.json({
        status: ready ? 'ok' : 'error',
        gitSha: process.env.BEACON_GIT_SHA ?? 'unknown',
        schemaVersion: process.env.BEACON_DATABASE_SCHEMA_VERSION ?? 'unknown',
        checks: publicChecks,
    }, {
        status: ready ? 200 : 503,
        headers: { 'Cache-Control': 'no-store' },
    });
}
