import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Live production staff binding runner contract', () => {
    it('uses an exact runtime image, a clean source checkout and fixed root-only input', async () => {
        const source = await readFile(new URL('../run-staff-account-binding.sh', import.meta.url), 'utf8');
        expect(source).toContain('harmonic-beacon/app:$runtime_sha');
        expect(source).toContain("git -C \"$root\" status --porcelain");
        expect(source).toContain('/etc/harmonic-beacon/live-production-secrets/staff-account-binding.env');
        expect(source).toContain('root:root:600');
        expect(source).toContain('BEACON_ACCOUNT_ENABLED');
        expect(source).toContain('https://account.harmonicbeacon.com');
    });

    it('gives the runner only a temporary internal database network and minimal environment', async () => {
        const source = await readFile(new URL('../run-staff-account-binding.sh', import.meta.url), 'utf8');
        expect(source).toContain('docker network create --internal');
        expect(source).toContain('--cap-drop ALL');
        expect(source).toContain('--security-opt no-new-privileges');
        expect(source).toContain('--read-only');
        expect(source).toContain('--env-file "$minimal_env"');
        expect(source).toContain('--cidfile "$runner_cidfile"');
        expect(source).not.toContain('--name "$runner"');
        expect(source).not.toContain('--env-file "$production_env"');
        expect(source).not.toContain('--network app_beacon');
        expect(source).not.toContain('LIVEKIT_API_SECRET=');
        expect(source).not.toContain('BEACON_ACCOUNT_CLIENT_SECRET=');
    });

    it('requires a verified database backup before apply and retains sanitized evidence', async () => {
        const source = await readFile(new URL('../run-staff-account-binding.sh', import.meta.url), 'utf8');
        expect(source).toContain('pg_dump');
        expect(source).toContain('pg_restore --list');
        expect(source).toContain('live.before.dump');
        expect(source).toContain('subjectDigest');
        expect(source).not.toContain('ACCOUNT_SUBJECT=$(env_value');
    });
});
