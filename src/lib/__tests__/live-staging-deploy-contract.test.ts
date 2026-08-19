import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('isolated Live staging deploy contract', () => {
    const compose = read('deploy/live-staging.compose.yml');
    const envExample = read('deploy/live-staging.env.example');
    const accountEnvExample = read('deploy/live-staging-account.env.example');
    const nginx = read('deploy/nginx-live-staging-loopback.conf');
    const nginxAcme = read('deploy/nginx-live-staging-acme-bootstrap.conf');
    const nginxPublic = read('deploy/nginx-live-staging-public.conf');
    const runbook = read('deploy/LIVE_STAGING.md');
    const dockerfile = read('Dockerfile');
    const accountSecretSync = read('scripts/live-staging/account-secret-sync.mjs');
    const accountPreflight = read('scripts/live-staging/account-preflight.mjs');

    it('uses staging-only names, storage, loopback ports and networks', () => {
        expect(compose).toContain('name: hb-live-staging');
        expect(compose).toContain(
            'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777',
        );
        expect(compose).toContain('container_name: hb-live-staging-app');
        expect(compose).toContain('container_name: hb-live-staging-postgres');
        expect(compose).toContain('/mnt/beacon-data/live-staging/postgres');
        expect(compose).toContain('127.0.0.1:3200:3000');
        expect(compose).toContain('name: hb_live_staging_database');
        expect(compose).toContain('name: hb_live_staging_app_egress');
        expect(compose).toMatch(/database:\n\s+name: hb_live_staging_database\n\s+internal: true/);
        expect(compose).not.toContain('container_name: beacon-app');
        expect(compose).not.toContain('container_name: beacon-postgres');
        expect(compose).not.toContain('/etc/harmonic-beacon/production.env');
        expect(compose).not.toContain('/mnt/beacon-data/postgres:');
        expect(compose).toContain(
            '${LIVE_STAGING_ENV_FILE:-/etc/harmonic-beacon/live-staging.env}',
        );
    });

    it('requires immutable app provenance and keeps Account default-off', () => {
        expect(compose).toContain('harmonic-beacon/live-staging:${BEACON_IMAGE_TAG:?');
        expect(compose).toContain('BEACON_GIT_SHA: ${BEACON_GIT_SHA:?');
        expect(compose).toContain('BEACON_BUILD_TIME: ${BEACON_BUILD_TIME:?');
        expect(compose).toContain('BEACON_DATABASE_SCHEMA_VERSION: ${BEACON_DATABASE_SCHEMA_VERSION:?');
        expect(compose).toContain('BEACON_ACCOUNT_ENABLED: ${BEACON_ACCOUNT_ENABLED:-false}');
        expect(envExample).toContain('BEACON_ACCOUNT_ENABLED=false');
        expect(envExample).toContain('E2E_DASHBOARD_ENABLED=0');
        expect(envExample).not.toMatch(/^BEACON_ACCOUNT_CLIENT_SECRET=/m);
        expect(accountEnvExample).toContain('BEACON_ACCOUNT_CLIENT_SECRET=<');
        expect(runbook).toContain("grep -Fxq 'BEACON_ACCOUNT_ENABLED=false'");
        expect(compose).toContain('E2E_DASHBOARD_ENABLED: ${E2E_DASHBOARD_ENABLED:-0}');
    });

    it('mounts the optional confidential RP bundle only into the app', () => {
        const postgres = compose.match(/\n  postgres:\n([\s\S]*?)\n  migrate:/)?.[1] ?? '';
        const migrate = compose.match(/\n  migrate:\n([\s\S]*?)\n  app:/)?.[1] ?? '';
        const app = compose.match(/\n  app:\n([\s\S]*?)\nnetworks:/)?.[1] ?? '';
        const secretPath = '/etc/harmonic-beacon/live-staging-secrets/account.env';
        expect(postgres).not.toContain(secretPath);
        expect(migrate).not.toContain(secretPath);
        expect(app).toContain(secretPath);
        expect(app).toMatch(/live-staging-secrets\/account\.env\}\n\s+required: false/);
        expect(dockerfile).toContain('/app/scripts/live-staging ./scripts/live-staging');
    });

    it('syncs offline and verifies the exact staging client with least-privilege egress', () => {
        expect(accountSecretSync).toContain('/etc/harmonic-beacon/account.staging.env');
        expect(accountSecretSync).toContain('/etc/harmonic-beacon/live-staging.env');
        expect(accountSecretSync).toContain('/etc/harmonic-beacon/live-staging-secrets/account.env');
        expect(accountPreflight).toContain('/etc/harmonic-beacon/live-staging-secrets/account.env');
        expect(accountPreflight).not.toContain('/etc/harmonic-beacon/account.staging.env');
        expect(accountPreflight).not.toContain('/etc/harmonic-beacon/live-staging.env');
        for (const script of [accountSecretSync, accountPreflight]) expect(script).not.toContain('console.log');
        expect(accountSecretSync).toContain('BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING');
        expect(accountSecretSync).toContain('BEACON_ACCOUNT_ENABLED must remain false');
        expect(accountSecretSync).toContain('this command accepts no paths or secret values');
        expect(accountPreflight).toContain('https://account-staging.harmonicbeacon.com');
        expect(accountPreflight).toContain("const CLIENT_ID = 'hb-live-staging'");
        expect(accountPreflight).toContain('/.well-known/openid-configuration');
        expect(accountPreflight).toContain('/.well-known/jwks.json');
        expect(accountPreflight).toContain("userinfo_endpoint: '/api/account/auth/oauth2/userinfo'");
        expect(accountPreflight).toContain('/api/account/session-status');
        expect(accountPreflight).toContain("body: new URLSearchParams({ sid: 'live-staging-preflight', sub: 'live-staging-preflight' })");
        expect(accountPreflight).toContain("status.active !== false");
        expect(accountPreflight).toContain("includes('no-store')");
        expect(runbook).toContain('one-shot, networkless container');
        expect(runbook).toContain('node /app/scripts/live-staging/account-preflight.mjs public');
        const preparedCommand = runbook.match(
            /sudo docker run --rm --read-only --user 0:0 \\\n([\s\S]*?)account-preflight\.mjs prepared/,
        )?.[1] ?? '';
        const publicCommand = runbook.match(
            /sudo docker run --rm --read-only --user 0:0 \\\n([\s\S]*?)account-preflight\.mjs public/,
        )?.[1] ?? '';
        for (const command of [preparedCommand, publicCommand]) {
            expect(command).toContain('/etc/harmonic-beacon/live-staging-secrets/account.env');
            expect(command).not.toContain('src=/etc/harmonic-beacon/account.staging.env,');
            expect(command).not.toContain('src=/etc/harmonic-beacon/live-staging.env,');
        }
        expect(runbook).toContain('never sees the Account');
        expect(runbook).toContain('ticket pepper');
    });

    it('runs migrations once and gates app startup on their success', () => {
        expect(compose).toMatch(/\n  migrate:\n/);
        expect(compose).toContain('command: [npx, prisma, migrate, deploy]');
        expect(compose).toMatch(/migrate:\n\s+condition: service_completed_successfully/);
        expect(runbook).toContain("docker inspect hb-live-staging-migrate-1 --format '{{.State.ExitCode}}'");
    });

    it('does not deploy or borrow the production media/event stack', () => {
        expect(compose).not.toMatch(/^\s{2}(livekit|playlist-bot|tapestry|commerce-reconciler):/m);
        expect(compose).toContain('LIVEKIT_INTERNAL_URL: http://livekit-unavailable.invalid:7880');
        expect(nginx).toMatch(/location \^~ \/rtc \{\n\s+return 503;/);
        expect(runbook).toContain('Room and ticket behavior remain covered');
        expect(runbook).toContain('it was not');
    });

    it('keeps the acceptance vhost on loopback and internal APIs dark', () => {
        expect(nginx).toContain('listen 127.0.0.1:13200;');
        expect(nginx).toContain('server_name live-staging.harmonicbeacon.com;');
        expect(nginx).toContain('proxy_pass http://127.0.0.1:3200;');
        expect(nginx).toMatch(/location = \/api\/internal \{\n\s+return 404;/);
        expect(nginx).toMatch(/location \^~ \/api\/internal\/ \{\n\s+return 404;/);
        expect(nginx).toMatch(/location = \/test-login \{\n\s+return 404;/);
        expect(nginx).toMatch(/location = \/api\/test-login \{\n\s+return 404;/);
        expect(nginx).toContain('if ($host != live-staging.harmonicbeacon.com) { return 444; }');
        expect(nginx).toContain('client_max_body_size 64k;');
        expect(nginx).toContain('limit_req zone=live_staging_general');
        expect(nginx).toContain('limit_req zone=live_staging_auth');
        expect(nginx).toContain('proxy_set_header Authorization "";');
        for (const route of [
            '/api/account/login',
            '/api/account/callback',
            '/api/account/frontchannel-logout',
        ]) {
            const escaped = route.replaceAll('/', '\\/');
            expect(nginx).toMatch(
                new RegExp(`location = ${escaped} \\{[\\s\\S]*?access_log off;[\\s\\S]*?proxy_pass http:\\/\\/127\\.0\\.0\\.1:3200;`),
            );
        }
        for (const route of ['/api/account/login', '/api/account/callback']) {
            const escaped = route.replaceAll('/', '\\/');
            expect(nginx).toMatch(
                new RegExp(`location = ${escaped} \\{[\\s\\S]*?add_header X-Content-Type-Options "nosniff" always;[\\s\\S]*?add_header X-Frame-Options "SAMEORIGIN" always;[\\s\\S]*?add_header X-Harmonic-Beacon-Environment "live-staging" always;[\\s\\S]*?proxy_pass`),
            );
        }
        const frontchannel = nginx.match(
            /location = \/api\/account\/frontchannel-logout \{([\s\S]*?)\n    \}/,
        )?.[1] ?? '';
        expect(frontchannel).toContain('add_header X-Content-Type-Options "nosniff" always;');
        expect(frontchannel).toContain('add_header X-Harmonic-Beacon-Environment "live-staging" always;');
        expect(frontchannel).not.toContain('add_header X-Frame-Options');
        expect(frontchannel).toContain('CSP frame-ancestors');
        expect(nginx).toMatch(/location \^~ \/api\/account\/ \{\n\s+access_log off;\n\s+return 404;/);
        expect(nginx).not.toContain('proxy_pass http://127.0.0.1:3200/api/account');
        expect(nginx).not.toMatch(/listen (?:\[::\]:)?(?:80|443)/);
    });

    it('provides a fail-closed ACME bootstrap and reviewed public TLS edge', () => {
        expect(nginxAcme).toContain('server_name live-staging.harmonicbeacon.com;');
        expect(nginxAcme).toContain('location ^~ /.well-known/acme-challenge/');
        expect(nginxAcme).toContain('location / { return 503; }');
        expect(nginxAcme).not.toContain('proxy_pass');

        expect(nginxPublic).toContain('listen 443 ssl http2;');
        expect(nginxPublic).toContain('/etc/letsencrypt/live/live-staging.harmonicbeacon.com/fullchain.pem');
        expect(nginxPublic).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains" always;');
        expect(nginxPublic).toMatch(/location \^~ \/rtc \{ return 503; \}/);
        expect(nginxPublic).toMatch(/location = \/api\/test-login \{ return 404; \}/);
        expect(nginxPublic).toMatch(/location \^~ \/api\/internal\/ \{ return 404; \}/);
        for (const route of [
            '/api/account/login',
            '/api/account/callback',
            '/api/account/frontchannel-logout',
        ]) {
            const escaped = route.replaceAll('/', '\\/');
            expect(nginxPublic).toMatch(
                new RegExp(`location = ${escaped} \\{[\\s\\S]*?access_log off;[\\s\\S]*?proxy_pass http:\\/\\/127\\.0\\.0\\.1:3200;`),
            );
        }
        expect(nginxPublic).toMatch(/location \^~ \/api\/account\/ \{\n\s+access_log off;\n\s+return 404;/);
        expect(runbook).toContain('nginx-live-staging-acme-bootstrap.conf');
        expect(runbook).toContain('nginx-live-staging-public.conf');
    });

    it('documents a non-destructive first deploy, exact smoke and rollback', () => {
        expect(runbook).toContain('test "$(git rev-parse HEAD)" = "$STAGING_SHA"');
        expect(runbook).toContain('test -z "$(git status --porcelain --untracked-files=no)"');
        expect(runbook).toContain('select count(*) from pg_catalog.pg_tables');
        expect(runbook).toContain('pg_dump');
        expect(runbook).toContain('gzip -t');
        expect(runbook).toContain('refuses to start the app unless it exits zero');
        expect(runbook).toContain('/api/health/ready');
        expect(runbook).toContain('/api/account/login)" = 404');
        expect(runbook).toContain('previous-image');
        expect(runbook).toContain('Never run `compose down -v`');
    });
});
