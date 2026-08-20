import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    buildTarget,
    parseEnv,
    validateTarget,
} from '../../../scripts/live-production/account-env.mjs';

const root = process.cwd();
const source = (relative: string) => readFileSync(path.join(root, relative), 'utf8');
const client = 'c'.repeat(64);
const authority = () => parseEnv([
    'BEACON_ACCOUNT_BASE_URL=https://account.harmonicbeacon.com',
    'BEACON_ACCOUNT_RUNTIME=1',
    `BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE=${client}`,
    'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING=',
    '',
].join('\n'));

describe('Live production Account app-only contract', () => {
    it('builds only the exact production hb-live bundle', () => {
        const first = buildTarget(authority());
        expect(first).toBe([
            'BEACON_ACCOUNT_ENABLED=true',
            'BEACON_ACCOUNT_ISSUER_URL=https://account.harmonicbeacon.com',
            'BEACON_ACCOUNT_CLIENT_ID=hb-live',
            `BEACON_ACCOUNT_CLIENT_SECRET=${client}`,
            '',
        ].join('\n'));
        expect([...validateTarget(parseEnv(first)).keys()]).toHaveLength(4);
    });

    it('rejects staging material, extra keys and shared secrets', () => {
        const withStaging = authority();
        withStaging.set('BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING', 'x'.repeat(64));
        expect(() => buildTarget(withStaging)).toThrow(/staging/);
        const extra = parseEnv(`${buildTarget(authority())}DATABASE_URL=forbidden\n`);
        expect(() => validateTarget(extra)).toThrow(/keys or ordering/);
    });

    it('mounts the secret bundle once and only on beacon-app', () => {
        const compose = source('docker-compose.yml');
        const bundle = '/etc/harmonic-beacon/live-production-secrets/account.env';
        expect(compose.split(bundle)).toHaveLength(2);
        const app = compose.slice(compose.indexOf('  app:'), compose.indexOf('  commerce-reconciler:'));
        expect(app).toContain(bundle);
        expect(compose.slice(0, compose.indexOf('  app:'))).not.toContain(bundle);
        expect(compose.slice(compose.indexOf('  commerce-reconciler:'))).not.toContain(bundle);
        const migrate = compose.slice(compose.indexOf('  migrate:'), compose.indexOf('  app:'));
        expect(migrate).not.toContain(bundle);
        expect(migrate).not.toContain('/etc/harmonic-beacon/commerce.env');
        expect(source('deploy/production.env.example')).not.toContain('BEACON_ACCOUNT_CLIENT_SECRET=');
    });

    it('ships fixed-path host preparation and a least-privilege network preflight', () => {
        const dockerfile = source('Dockerfile');
        const prepare = source('scripts/live-production/prepare-account.sh');
        const activate = source('scripts/live-production/activate-account.sh');
        const preflight = source('scripts/live-production/account-preflight.mjs');
        expect(dockerfile).toContain('/app/scripts/live-production ./scripts/live-production');
        expect(prepare).not.toContain('docker run');
        expect(prepare).toContain('authority=/etc/harmonic-beacon/account.production.env');
        expect(prepare).toContain('BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE');
        expect(prepare).not.toContain('DATABASE_URL');
        expect(prepare).toContain('flock -n 9');
        expect(prepare).toContain('Account is already active; use a separately reviewed credential rotation');
        expect(activate).toContain('src=$bundle,dst=/etc/harmonic-beacon/live-production-secrets/account.env,readonly');
        expect(activate).not.toContain('src=$production_env');
        expect(preflight).toContain("const LIVE_ORIGIN = 'https://live.harmonicbeacon.com'");
        expect(preflight).toContain("CLIENT_ID, ISSUER, TARGET_ENV");
        expect(preflight).toContain("'client_secret_basic'");
    });

    it('uses an exact no-log edge and denies the remaining Account prefix', () => {
        const nginx = source('deploy/nginx-harmonic-beacon.conf');
        for (const route of ['login', 'callback', 'frontchannel-logout']) {
            const start = nginx.indexOf(`location = /api/account/${route}`);
            expect(start).toBeGreaterThan(-1);
            expect(nginx.slice(start, nginx.indexOf('\n    }', start))).toContain('access_log off;');
        }
        expect(nginx).toContain('location ^~ /api/account/ {');
        expect(nginx).toMatch(/location \^~ \/api\/account\/ \{\s+access_log off;\s+return 404;/);
        expect(nginx).not.toContain('location ^~ /assets/');
    });

    it('recreates only the app and preserves a tested rollback boundary', () => {
        const activate = source('scripts/live-production/activate-account.sh');
        const rollback = source('scripts/live-production/rollback-account.sh');
        const smoke = source('scripts/live-production/health-smoke.sh');
        const deploy = source('deploy/hb-deploy-root');
        expect(activate).toContain('up -d --no-deps --force-recreate --no-build app');
        expect(activate).toContain('vhost=/etc/nginx/sites-available/harmonic-beacon');
        expect(activate).toContain('vhost_enabled=/etc/nginx/sites-enabled/harmonic-beacon');
        expect(activate).toContain('test -L "$vhost_enabled"');
        expect(activate).toContain('readlink -f "$vhost_enabled"');
        expect(activate).toContain('protected-containers.before');
        expect(activate).toContain('cmp -s "$state/protected-containers.before" "$state/protected-containers.after"');
        expect(activate).toContain('restoring Account-OFF app and prior vhost');
        expect(activate).toContain('"$state/rollback-account.sh"');
        expect(activate).toContain('"$state/docker-compose.yml"');
        expect(rollback).toContain('compose_file="$state/docker-compose.yml"');
        expect(rollback).toContain('vhost=/etc/nginx/sites-available/harmonic-beacon');
        expect(rollback).toContain('vhost_enabled=/etc/nginx/sites-enabled/harmonic-beacon');
        expect(rollback).toContain('test -L "$vhost_enabled"');
        expect(rollback).not.toContain('git -C');
        expect(rollback).toContain('mv "$bundle" "$disabled"');
        expect(rollback).toContain('.checks.account == "disabled"');
        expect(smoke).toContain("--connect-timeout 3 --max-time 8");
        expect(smoke).toContain("--proto '=https'");
        expect(smoke).toContain("test \"$status\" = 303 || { echo 'malformed Live Account callback was not bounded'");
        expect(smoke).toContain('/var/log/nginx/access.log');
        expect(smoke).not.toMatch(/\bnode\b/);
        expect(deploy).toContain('run --rm --no-deps migrate npx prisma migrate deploy');
        expect(deploy).toContain('Account RP secret reached unexpected container');
        expect(deploy).toContain('Account bundle exists before the supervised Account activation');
        expect(deploy).toContain("ACCOUNT_ENV='/etc/harmonic-beacon/live-production-secrets/account.env'");
    });
});
