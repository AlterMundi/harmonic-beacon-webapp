import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { it as test } from 'vitest';

const require = createRequire(import.meta.url);
const ts: typeof import('typescript') = require('typescript');
const ROOT = path.resolve(import.meta.dirname, '../../../..');
const ISSUER = 'https://account.harmonicbeacon.com';
// Frozen from runtime ca2d7a8b060d690fdc698a68831481b91617e010, not generated from the
// candidate. Config contains the issuer/client declarations used by provisioning.
const OLD_CONFIG = `const ACCOUNT_ORIGIN = 'https://account.harmonicbeacon.com';
const ACCOUNT_STAGING_ORIGIN = 'https://account-staging.harmonicbeacon.com';

type Environment = Record<string, string | undefined>;

function value(name: string, environment: Environment): string | undefined {
    const resolved = environment[name]?.trim();
    return resolved || undefined;
}

function flag(name: string, environment: Environment): boolean {
    const resolved = value(name, environment);
    if (resolved === undefined || resolved === '0') return false;
    if (resolved === '1') return true;
    throw new Error(\`\${name} must be 0 or 1\`);
}

function decodeBase64UrlJSON(value: string): unknown {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))));
}

export const ACCOUNT_AUTH_BASE_PATH = '/api/account/auth';
export const ACCOUNT_COOKIE_PREFIX = 'hb_account';
export const ACCOUNT_SESSION_COOKIE = '__Host-hb_account_session';
export const ACCOUNT_EMAIL_TTL_SECONDS = 15 * 60;

export function accountOrigin(environment: Environment = process.env): string {
    const configured = value('BEACON_ACCOUNT_BASE_URL', environment);
    if (configured) {
        const parsed = new URL(configured);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
            parsed.search || parsed.hash || parsed.pathname !== '/') {
            throw new Error('BEACON_ACCOUNT_BASE_URL must be an HTTPS origin');
        }
        return parsed.origin;
    }
    if (process.env.NODE_ENV === 'production') {
        throw new Error('BEACON_ACCOUNT_BASE_URL is required');
    }
    return 'http://localhost:3000';
}

export function accountEnvironment(environment: Environment = process.env): 'production' | 'staging' | 'local' {
    const origin = accountOrigin(environment);
    if (origin === ACCOUNT_ORIGIN) return 'production';
    if (origin === ACCOUNT_STAGING_ORIGIN) return 'staging';
    if (process.env.NODE_ENV !== 'production') return 'local';
    throw new Error('BEACON_ACCOUNT_BASE_URL is not an approved Account origin');
}

export const ACCOUNT_STATIC_CLIENTS = [
    {
        clientId: 'hb-listener',
        secretVariable: 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER',
        redirectUri: 'https://listen.harmonicbeacon.com/api/account/callback',
        postLogoutRedirectUri: 'https://listen.harmonicbeacon.com/api/account/frontchannel-logout',
        requiresCompleteProfile: false,
    },
    {
        clientId: 'hb-listener-staging',
        secretVariable: 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER_STAGING',
        redirectUri: 'https://earlybirds-staging.harmonicbeacon.com/api/account/callback',
        postLogoutRedirectUri: 'https://earlybirds-staging.harmonicbeacon.com/api/account/frontchannel-logout',
        requiresCompleteProfile: false,
    },
    {
        clientId: 'hb-live',
        secretVariable: 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE',
        redirectUri: 'https://live.harmonicbeacon.com/api/account/callback',
        postLogoutRedirectUri: 'https://live.harmonicbeacon.com/api/account/frontchannel-logout',
        requiresCompleteProfile: true,
    },
    {
        clientId: 'hb-live-staging',
        secretVariable: 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING',
        redirectUri: 'https://live-staging.harmonicbeacon.com/api/account/callback',
        postLogoutRedirectUri: 'https://live-staging.harmonicbeacon.com/api/account/frontchannel-logout',
        requiresCompleteProfile: true,
    },
    {
        clientId: 'hb-psicopompo',
        secretVariable: 'BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO',
        redirectUri: 'https://psicopompo.altermundi.net/api/auth/beacon/callback',
        postLogoutRedirectUri: null,
        requiresCompleteProfile: true,
    },
] as const;

export function accountStaticClientSecrets(environment: Environment = process.env) {
    return ACCOUNT_STATIC_CLIENTS.map((client) => ({
        ...client,
        clientSecret: value(client.secretVariable, environment) ?? null,
    }));
}

export function activeAccountStaticClients(environment: Environment = process.env) {
    const selected = accountEnvironment(environment);
    return ACCOUNT_STATIC_CLIENTS.filter((client) => {
        if (client.clientId === 'hb-psicopompo') {
            return selected !== 'staging' && environment.BEACON_ACCOUNT_PSICOPOMPO_ENABLED === '1';
        }
        return selected === 'local' ||
            (selected === 'staging') === client.clientId.endsWith('-staging');
    });
}

/** Phase-two provisioning matches the expanded static-client constraint. */
export const ACCOUNT_PROVISIONED_SCOPES = ['openid', 'profile', 'email'];

`;
const OLD_PROVISIONER = `import { randomUUID } from 'node:crypto';

import { prisma } from '../src/lib/db';
import {
    ACCOUNT_PROVISIONED_SCOPES,
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
        if (!secret || secret.length < 32) throw new Error(\`\${client.secretVariable} is missing or too short\`);
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
                    scopes: ACCOUNT_PROVISIONED_SCOPES,
                    name: client.clientId,
                    redirectUris: [client.redirectUri],
                    postLogoutRedirectUris: client.postLogoutRedirectUri ? [client.postLogoutRedirectUri] : [],
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
                    scopes: ACCOUNT_PROVISIONED_SCOPES,
                    redirectUris: [client.redirectUri],
                    postLogoutRedirectUris: client.postLogoutRedirectUri ? [client.postLogoutRedirectUri] : [],
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
    process.stdout.write(\`Account authority provisioned for \${issuer}; \${active.length} static clients active.\\n\`);
}

main().finally(() => prisma.$disconnect()).catch((error) => {
    process.stderr.write(\`\${error instanceof Error ? error.message : 'Account provisioning failed'}\\n\`);
    process.exitCode = 1;
});
`;

type Environment = Record<string, string | undefined>;
type Marker = { issuer: string; id?: string } | null;
type ClientRow = { id: string; clientId: string; disabled: boolean; [key: string]: unknown };
type State = {
  marker: Marker; rows: Record<string, ClientRow>;
  identities?: string[]; mail?: string[];
};
type Event = (event: string) => void;

function evaluate(source: string, environment: Environment,
  imports: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  const context: Record<string, unknown> = {
    exports, process: { env: environment }, URL, TextDecoder, Uint8Array, atob,
    require: (name: string) => imports[name] ?? require(name), ...globals,
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { exports, context };
}

function fixtureConfig(environment: Environment, old = false) {
  return evaluate(old ? OLD_CONFIG : fs.readFileSync(
    path.join(ROOT, 'src/lib/account/config.ts'), 'utf8',
  ), environment).exports;
}

function markerFor(state: State, fault: string, event: Event, transactional = false) {
  return {
    findUnique: async () => {
      event(transactional ? 'issuer-transaction' : 'issuer-precheck');
      return fault === 'issuer-race' && transactional ? { issuer: 'https://other.example' } : state.marker;
    },
    create: async ({ data }: { data: NonNullable<Marker> }) => { state.marker = data; },
  };
}

function transactionFor(state: State, fault: string, event: Event) {
  return {
    beaconAccountAuthorityEnvironment: markerFor(state, fault, event, true),
    beaconOAuthClient: {
      upsert: async ({ where, create, update }: {
        where: { clientId: string }; create: ClientRow; update: Partial<ClientRow>;
      }) => {
        if (fault === 'upsert' && where.clientId === 'hb-live') throw new Error('synthetic transaction failure');
        state.rows[where.clientId] = state.rows[where.clientId]
          ? { ...state.rows[where.clientId], ...update } : create;
      },
      updateMany: async ({ where, data }: {
        where: { clientId: { notIn: string[] } }; data: Partial<ClientRow>;
      }) => {
        for (const [id, row] of Object.entries(state.rows)) {
          if (!where.clientId.notIn.includes(id)) Object.assign(row, data);
        }
      },
    },
  };
}

async function provision(state: State, environment: Environment,
  { old = false, fault = '', event = (() => {}) as Event } = {}) {
  const fakeProcess: {
    env: Environment; stdout: { write(): void }; stderr: { write(): void }; exitCode?: number;
  } = { env: environment, stdout: { write() {} }, stderr: { write() {} } };
  const prisma = {
    beaconAccountAuthorityEnvironment: markerFor(state, fault, event),
    $disconnect: async () => {},
    $transaction: async (callback: (transaction: ReturnType<typeof transactionFor>) => Promise<void>) => {
      event('transaction');
      const working = structuredClone(state);
      await callback(transactionFor(working, fault, event));
      Object.assign(state, working);
      event('commit');
    },
  };
  const code = old ? OLD_PROVISIONER : fs.readFileSync(
    path.join(ROOT, 'scripts/provision-account-authority.ts'), 'utf8',
  );
  const clientSecret = evaluate(fs.readFileSync(
    path.join(ROOT, 'src/lib/account/client-secret.ts'), 'utf8',
  ), environment).exports;
  const { context } = evaluate(code.replace('main().finally', 'globalThis.completion = main().finally'), environment, {
    '../src/lib/db': { prisma },
    '../src/lib/account/config': fixtureConfig(environment, old),
    '../src/lib/account/client-secret': clientSecret,
    '../src/lib/account/auth': {
      accountAuth: () => ({ api: { getJwks: async () => {
        event('jwks');
        if (fault === 'jwks') throw new Error('synthetic JWKS failure');
      } } }),
    },
  }, { process: fakeProcess });
  await context.completion;
  return fakeProcess.exitCode ?? 0;
}

function trialEnvironment(): Environment {
  return {
    NODE_ENV: 'production', BEACON_ACCOUNT_BASE_URL: ISSUER,
    BEACON_ACCOUNT_PROVISION_CONFIRM_ISSUER: ISSUER,
    BEACON_ACCOUNT_PSICOPOMPO_ENABLED: '1', BEACON_ACCOUNT_PSICOPOMPO_TRIAL_ENABLED: '1',
    BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER: 'listener-'.repeat(8),
    BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE: 'live-'.repeat(12),
    BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO: 'pmp-'.repeat(12),
    BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO_TRIAL: 'trial-'.repeat(12),
  };
}

const snapshot = (state: State): State => JSON.parse(JSON.stringify(state));
const active = (state: State) => Object.keys(state.rows).filter((id) => !state.rows[id].disabled).sort();
const priorIds = ['hb-listener', 'hb-live', 'hb-psicopompo'];
const initial = (): State => ({
  marker: { issuer: ISSUER }, rows: {}, identities: ['unchanged-human'], mail: ['unchanged-receipt'],
});

test('real candidate validates issuer before JWKS and revalidates inside transaction', async () => {
  const environment = trialEnvironment();
  for (const fault of ['other-issuer', 'jwks', 'issuer-race']) {
    const state: State = { marker: { issuer: fault === 'other-issuer' ? 'https://other.example' : ISSUER }, rows: {} };
    const before = snapshot(state);
    const events: string[] = [];
    assert.equal(await provision(state, environment, { fault, event: (e) => events.push(e) }), 1);
    assert.deepEqual(snapshot(state), before);
    if (fault === 'other-issuer') assert.deepEqual(events, ['issuer-precheck']);
    if (fault === 'jwks') assert.deepEqual(events, ['issuer-precheck', 'jwks']);
    if (fault === 'issuer-race') assert.deepEqual(events, ['issuer-precheck', 'jwks', 'transaction', 'issuer-transaction']);
  }
  const events: string[] = [];
  const state: State = { marker: null, rows: {} };
  assert.equal(await provision(state, environment, { event: (e) => events.push(e) }), 0);
  assert.deepEqual(events, ['issuer-precheck', 'jwks', 'transaction', 'issuer-transaction', 'commit']);
  assert.equal(state.marker?.issuer, ISSUER);
});

test('real current and frozen ca2d sources roundtrip four to three without changing prior contracts', async () => {
  const environment = trialEnvironment();
  const state = initial();
  assert.equal(await provision(state, environment, { old: true }), 0);
  const before = snapshot(state);
  assert.deepEqual(active(state), priorIds);
  assert.equal(await provision(state, environment), 0);
  assert.deepEqual(active(state), [...priorIds, 'hb-psicopompo-trial']);
  const candidate = snapshot(state);
  assert.equal(await provision(state, environment), 0);
  assert.deepEqual(snapshot(state), candidate);
  assert.equal(await provision(state, environment, { old: true }), 0);
  assert.deepEqual(active(state), priorIds);
  assert.equal(state.rows['hb-psicopompo-trial'].disabled, true);
  // A second protected rollback after the trap is functionally repeatable.
  assert.equal(await provision(state, environment, { old: true }), 0);
  const restored = snapshot(state);
  delete restored.rows['hb-psicopompo-trial'];
  assert.deepEqual(restored, before);
});

test('real ca2d keeps its postcommit JWKS error and real candidate fails JWKS before client writes', async () => {
  const state = initial();
  const environment = trialEnvironment();
  assert.equal(await provision(state, environment, { old: true }), 0);
  const before = snapshot(state);
  assert.equal(await provision(state, environment, { fault: 'jwks' }), 1);
  assert.deepEqual(snapshot(state), before);
  assert.equal(await provision(state, environment), 0);
  const events: string[] = [];
  assert.equal(await provision(state, environment, { old: true, fault: 'jwks', event: (e) => events.push(e) }), 1);
  assert.deepEqual(events, ['transaction', 'issuer-transaction', 'commit', 'jwks']);
  assert.deepEqual(active(state), priorIds);
  assert.equal(state.rows['hb-psicopompo-trial'].disabled, true);
});

test('real provisioning rolls back partial client writes if an upsert fails inside transaction', async () => {
  const state = initial();
  const environment = trialEnvironment();
  assert.equal(await provision(state, environment, { old: true }), 0);
  const before = snapshot(state);
  const events: string[] = [];
  assert.equal(await provision(state, environment, { fault: 'upsert', event: (e) => events.push(e) }), 1);
  assert.deepEqual(snapshot(state), before);
  assert.ok(!events.includes('commit'));
});
