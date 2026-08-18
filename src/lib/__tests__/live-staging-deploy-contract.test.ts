import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('isolated Live staging deploy contract', () => {
    const compose = read('deploy/live-staging.compose.yml');
    const envExample = read('deploy/live-staging.env.example');
    const nginx = read('deploy/nginx-live-staging-loopback.conf');
    const runbook = read('deploy/LIVE_STAGING.md');

    it('uses staging-only names, storage, loopback ports and networks', () => {
        expect(compose).toContain('name: hb-live-staging');
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
        expect(envExample).not.toMatch(/^BEACON_ACCOUNT_CLIENT_SECRET=/m);
        expect(runbook).toContain("grep -Fxq 'BEACON_ACCOUNT_ENABLED=false'");
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
        expect(nginx).not.toMatch(/listen (?:\[::\]:)?(?:80|443)/);
    });

    it('documents a non-destructive first deploy, exact smoke and rollback', () => {
        expect(runbook).toContain('test "$(git rev-parse HEAD)" = "$STAGING_SHA"');
        expect(runbook).toContain('test -z "$(git status --porcelain --untracked-files=no)"');
        expect(runbook).toContain('select count(*) from pg_catalog.pg_tables');
        expect(runbook).toContain('npx prisma migrate deploy');
        expect(runbook).toContain('/api/health/ready');
        expect(runbook).toContain('/api/account/login)" = 404');
        expect(runbook).toContain('previous-image');
        expect(runbook).toContain('Never run `compose down -v`');
    });
});
