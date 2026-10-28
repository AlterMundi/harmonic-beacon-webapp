import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseURL = process.env.LISTENER_TEST_DATABASE_URL;
const postgres = databaseURL ? describe : describe.skip;
const migrationPath = path.resolve('prisma/migrations/20261028100000_account_oauth_provider_17/migration.sql');
const keyMigrationPath = path.resolve('prisma/migrations/20261028100500_account_jwt_key_metadata/migration.sql');

async function legacySchema(run: (db: pg.Client) => Promise<void>) {
    const url = new URL(databaseURL!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !url.pathname.endsWith('_test')) throw new Error('Isolated local test database required');
    const schema = `test_oauth17_${randomUUID().replaceAll('-', '')}`;
    const db = new pg.Client({ connectionString: databaseURL });
    await db.connect();
    try {
        await db.query(`CREATE SCHEMA "${schema}"`);
        // No public fallback: a missing fixture table cannot mutate another
        // suite's schema through this unqualified production migration.
        await db.query(`SET search_path TO "${schema}"`);
        expect((await db.query('SELECT current_schema() AS name')).rows[0].name).toBe(schema);
        await db.query(`
            CREATE TABLE early_bird_auth_sessions (id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL);
            CREATE TABLE beacon_oauth_clients (
                id TEXT PRIMARY KEY, client_id TEXT UNIQUE NOT NULL,
                "public" BOOLEAN NOT NULL DEFAULT false, type TEXT, scopes TEXT[], disabled BOOLEAN DEFAULT false
            );
            CREATE TABLE beacon_oauth_access_tokens (
                id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, client_id TEXT NOT NULL,
                session_id TEXT REFERENCES early_bird_auth_sessions(id) ON DELETE CASCADE, scopes TEXT[]
            );
            CREATE TABLE beacon_oauth_refresh_tokens (
                id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, client_id TEXT NOT NULL,
                session_id TEXT REFERENCES early_bird_auth_sessions(id) ON DELETE CASCADE,
                scopes TEXT[], revoked TIMESTAMP(3)
            );
            CREATE TABLE beacon_oauth_consents (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, scopes TEXT[]);
            CREATE TABLE beacon_jwks (
                id TEXT PRIMARY KEY, public_key TEXT NOT NULL, private_key TEXT NOT NULL,
                created_at TIMESTAMP(3) NOT NULL, expires_at TIMESTAMP(3)
            );
            INSERT INTO early_bird_auth_sessions VALUES ('session', 'existing-session-verifier');
            INSERT INTO beacon_oauth_clients VALUES ('client-row', 'client', false, 'web', ARRAY['openid'], false);
            INSERT INTO beacon_oauth_access_tokens VALUES ('access', 'access-verifier', 'client', 'session', ARRAY['openid']);
            INSERT INTO beacon_oauth_refresh_tokens VALUES ('refresh', 'refresh-verifier', 'client', 'session', ARRAY['openid'], NULL);
            INSERT INTO beacon_oauth_consents VALUES ('consent', 'client', ARRAY['openid']);
        `);
        await run(db);
    } finally {
        await db.query('ROLLBACK').catch(() => undefined);
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.end();
    }
}

postgres('OAuth provider 1.7 additive migration', () => {
    it('preserves legacy clients, token verifiers, consent and session-revocation behavior', async () => {
        await legacySchema(async (db) => {
            const client = (await db.query('SELECT * FROM beacon_oauth_clients')).rows[0];
            await db.query(await readFile(migrationPath, 'utf8'));
            expect((await db.query('SELECT id,client_id,"public",type,scopes,disabled FROM beacon_oauth_clients')).rows[0])
                .toEqual(client);
            expect((await db.query('SELECT token,resources,revoked FROM beacon_oauth_access_tokens')).rows)
                .toEqual([{ token: 'access-verifier', resources: [], revoked: null }]);
            expect((await db.query('SELECT token,resources,revoked FROM beacon_oauth_refresh_tokens')).rows)
                .toEqual([{ token: 'refresh-verifier', resources: [], revoked: null }]);
            expect((await db.query('SELECT scopes,resources FROM beacon_oauth_consents')).rows)
                .toEqual([{ scopes: ['openid'], resources: [] }]);
            expect((await db.query('SELECT COUNT(*)::int AS count FROM beacon_oauth_client_resources')).rows[0].count).toBe(0);
            expect((await db.query('SELECT client_credentials_scopes,dpop_bound_access_tokens FROM beacon_oauth_clients')).rows[0])
                .toEqual({ client_credentials_scopes: [], dpop_bound_access_tokens: false });
            // The prior application can still write its original column set.
            await db.query(`INSERT INTO beacon_oauth_clients(id,client_id,"public",type,scopes)
                VALUES ('old-writer','old-client',false,'web',ARRAY['openid'])`);
            await db.query("DELETE FROM early_bird_auth_sessions WHERE id='session'");
            expect((await db.query('SELECT COUNT(*)::int AS count FROM beacon_oauth_access_tokens')).rows[0].count).toBe(0);
            expect((await db.query('SELECT COUNT(*)::int AS count FROM beacon_oauth_refresh_tokens')).rows[0].count).toBe(0);
            expect((await db.query('SELECT COUNT(*)::int AS count FROM beacon_oauth_consents')).rows[0].count).toBe(1);
        });
    });

    it('enforces exact resource linkage, uniqueness and cascading removal', async () => {
        await legacySchema(async (db) => {
            await db.query(await readFile(migrationPath, 'utf8'));
            await db.query(`INSERT INTO beacon_oauth_resources(id,identifier,name)
                VALUES ('resource','https://resource.example.invalid','Test resource')`);
            await db.query(`INSERT INTO beacon_oauth_client_resources(id,client_id,resource_id)
                VALUES ('link','client','https://resource.example.invalid')`);
            await expect(db.query(`INSERT INTO beacon_oauth_client_resources(id,client_id,resource_id)
                VALUES ('duplicate','client','https://resource.example.invalid')`)).rejects.toMatchObject({ code: '23505' });
            await expect(db.query(`INSERT INTO beacon_oauth_client_resources(id,client_id,resource_id)
                VALUES ('unregistered','client','https://other.example.invalid')`)).rejects.toMatchObject({ code: '23503' });
            await db.query("DELETE FROM beacon_oauth_clients WHERE client_id='client'");
            expect((await db.query('SELECT COUNT(*)::int AS count FROM beacon_oauth_client_resources')).rows[0].count).toBe(0);
        });
    });

    it('adds nullable JWT metadata without rewriting existing key bytes or IDs', async () => {
        await legacySchema(async (db) => {
            await db.query(`INSERT INTO beacon_jwks(id,public_key,private_key,created_at)
                VALUES ('legacy-key','public-key-marker','private-key-marker','2026-10-01T00:00:00Z')`);
            const before = (await db.query('SELECT * FROM beacon_jwks')).rows[0];
            await db.query(await readFile(keyMigrationPath, 'utf8'));
            const { alg, crv, ...after } = (await db.query('SELECT * FROM beacon_jwks')).rows[0];
            expect(after).toEqual(before);
            expect({ alg, crv }).toEqual({ alg: null, crv: null });
            await db.query(`INSERT INTO beacon_jwks(id,public_key,private_key,created_at)
                VALUES ('old-writer','public-key-marker','private-key-marker',CURRENT_TIMESTAMP)`);
        });
    });

    it('rolls back all earlier DDL if a later provider-table creation fails', async () => {
        await legacySchema(async (db) => {
            await db.query('CREATE TABLE beacon_oauth_resources (marker TEXT)');
            await db.query("INSERT INTO beacon_oauth_resources VALUES ('preserved-blocker')");
            await expect(db.query(await readFile(migrationPath, 'utf8'))).rejects.toMatchObject({ code: '42P07' });
            await db.query('ROLLBACK');
            const added = await db.query(`SELECT column_name FROM information_schema.columns
                WHERE table_schema=current_schema() AND column_name IN ('resources','client_discovery_id')`);
            expect(added.rows).toEqual([]);
            expect((await db.query('SELECT * FROM beacon_oauth_resources')).rows).toEqual([{ marker: 'preserved-blocker' }]);
            expect((await db.query('SELECT token FROM beacon_oauth_access_tokens')).rows).toEqual([{ token: 'access-verifier' }]);
        });
    });
});
