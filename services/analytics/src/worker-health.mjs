import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.ANALYTICS_DATABASE_ADMIN_URL ?? process.env.ANALYTICS_DATABASE_URL;
if (!connectionString) process.exit(1);
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
try {
    const result = await pool.query(`select status,updated_at > now()-interval '2 minutes' fresh
        from ops.source_watermarks where source='worker'`);
    process.exitCode = result.rows[0]?.status === 'ok' && result.rows[0]?.fresh === true ? 0 : 1;
} catch { process.exitCode = 1; }
finally { await pool.end(); }
