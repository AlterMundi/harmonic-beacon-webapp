import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integration = process.env.STAGE_GRANT_INTEGRATION_TEST === '1'
    ? describe
    : describe.skip;

const migration = readFileSync(
    'prisma/migrations/20260905060000_stage_grant_effect_outbox/migration.sql',
    'utf8',
);

integration('stage grant migration legacy upgrade', () => {
    const schema = `stage_upgrade_${randomUUID().replaceAll('-', '')}`;
    let client: Client;

    beforeAll(async () => {
        const configured = process.env.DATABASE_URL;
        if (!configured) throw new Error('stage grant migration DATABASE_URL is required');
        const expectedDatabase = new URL(configured).pathname.replace(/^\//, '');
        if (!expectedDatabase.endsWith('_test')) {
            throw new Error('stage grant migration writes require a *_test database');
        }
        client = new Client({ connectionString: configured });
        await client.connect();
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`SET search_path TO "${schema}"`);
        await client.query(`
            CREATE TABLE scheduled_sessions (id UUID PRIMARY KEY);
            CREATE TABLE session_participants (
                id UUID PRIMARY KEY,
                scheduled_session_id UUID NOT NULL REFERENCES scheduled_sessions(id),
                participant_identity TEXT NOT NULL,
                publish_granted_at TIMESTAMP(3),
                publish_revoked_at TIMESTAMP(3),
                grant_version INTEGER NOT NULL DEFAULT 0,
                grant_reconcile_needed BOOLEAN NOT NULL DEFAULT false,
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);
        const sessionId = randomUUID();
        await client.query('INSERT INTO scheduled_sessions (id) VALUES ($1)', [sessionId]);
        await client.query(`
            INSERT INTO session_participants (
                id, scheduled_session_id, participant_identity,
                publish_granted_at, publish_revoked_at, grant_reconcile_needed
            ) VALUES
                ($1, $4, 'legacy-active', CURRENT_TIMESTAMP - INTERVAL '1 hour', NULL, false),
                ($2, $4, 'legacy-revoked', CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour', false),
                ($3, $4, 'never-publisher', NULL, NULL, false)
        `, [randomUUID(), randomUUID(), randomUUID(), sessionId]);
    });

    afterAll(async () => {
        if (!client) return;
        await client.query('SET search_path TO public');
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await client.end();
    });

    it('marks both active and already-revoked legacy publishers for a conservative fence', async () => {
        const before = Date.now();
        await client.query(migration);
        const after = Date.now();
        const { rows } = await client.query<{
            participant_identity: string;
            grant_reconcile_needed: boolean;
            horizon_ms: string | null;
        }>(`
            SELECT participant_identity, grant_reconcile_needed,
                   CASE WHEN max_livekit_token_expires_at IS NULL THEN NULL
                        ELSE (EXTRACT(EPOCH FROM max_livekit_token_expires_at) * 1000)::bigint::text
                   END AS horizon_ms
            FROM session_participants
            ORDER BY participant_identity
        `);
        const byIdentity = new Map(rows.map((row) => [row.participant_identity, row]));
        for (const identity of ['legacy-active', 'legacy-revoked']) {
            const row = byIdentity.get(identity)!;
            expect(row.grant_reconcile_needed).toBe(true);
            const horizon = Number(row.horizon_ms);
            expect(horizon).toBeGreaterThanOrEqual(before + 4 * 60 * 60 * 1000 - 1_000);
            expect(horizon).toBeLessThanOrEqual(after + 4 * 60 * 60 * 1000 + 1_000);
        }
        expect(byIdentity.get('never-publisher')).toMatchObject({
            grant_reconcile_needed: false,
            horizon_ms: null,
        });
    });
});
