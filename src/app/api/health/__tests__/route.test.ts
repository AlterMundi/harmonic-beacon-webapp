import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseResponse } from '@/__tests__/helpers';

describe('GET /api/health', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllEnvs();
    });

    it('returns release provenance without querying the database', async () => {
        vi.stubEnv('BEACON_GIT_SHA', 'a'.repeat(40));
        vi.stubEnv('BEACON_BUILD_TIME', '2026-08-04T18:30:00Z');
        vi.stubEnv('BEACON_DATABASE_SCHEMA_VERSION', '20260804100000_hmp_august_8_paid_sessions');
        const queryRaw = vi.fn();
        const mockPrisma = { $queryRaw: queryRaw };

        // Liveness must never touch the database — mock it and assert it's
        // never called, which is the whole point of separating this from
        // /api/health/ready.
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as {
            schemaVersion: string;
            status: string;
            uptime: number;
            version: string;
            gitSha: string;
            buildTime: string;
            databaseSchemaVersion: string;
            contractVersions: { commerceEntitlement: string };
        };
        expect(data.schemaVersion).toBe('health.response.v2');
        expect(data.status).toBe('ok');
        expect(typeof data.uptime).toBe('number');
        expect(typeof data.version).toBe('string');
        expect(data.gitSha).toBe('a'.repeat(40));
        expect(data.buildTime).toBe('2026-08-04T18:30:00Z');
        expect(data.databaseSchemaVersion).toBe('20260804100000_hmp_august_8_paid_sessions');
        expect(data.contractVersions).toEqual({ commerceEntitlement: 'commerce-entitlement.v1' });
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(queryRaw).not.toHaveBeenCalled();
    });

    it('fails closed to unknown provenance when build arguments are malformed', async () => {
        vi.stubEnv('BEACON_GIT_SHA', 'release-latest');
        vi.stubEnv('BEACON_BUILD_TIME', 'today');
        vi.stubEnv('BEACON_DATABASE_SCHEMA_VERSION', '../migrations');

        const { GET } = await import('../route');
        const response = await GET();
        const { body } = await parseResponse(response);

        expect(body).toEqual(expect.objectContaining({
            gitSha: 'unknown',
            buildTime: null,
            databaseSchemaVersion: 'unknown',
        }));
    });
});
