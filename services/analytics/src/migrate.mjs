import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.ANALYTICS_DATABASE_ADMIN_URL ?? process.env.ANALYTICS_DATABASE_URL;
if (!connectionString) throw new Error('ANALYTICS_DATABASE_ADMIN_URL is required');
const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
const client = new Client({ connectionString, application_name: 'hb-analytics-migrate' });
await client.connect();
try {
    await client.query('create schema if not exists ops');
    await client.query(`create table if not exists ops.schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
    )`);
    for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
        const sql = await readFile(`${directory}/${file}`, 'utf8');
        const { createHash } = await import('node:crypto');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const existing = await client.query('select checksum from ops.schema_migrations where version=$1', [file]);
        if (existing.rowCount) {
            if (existing.rows[0].checksum !== checksum) throw new Error(`migration checksum changed: ${file}`);
            continue;
        }
        await client.query('begin');
        try {
            await client.query(sql);
            await client.query('insert into ops.schema_migrations(version, checksum) values ($1,$2)', [file, checksum]);
            await client.query('commit');
        } catch (error) {
            await client.query('rollback');
            throw error;
        }
    }
} finally {
    await client.end();
}
