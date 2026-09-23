/** Explicit owner-authorized staff promotion; dry-run unless --apply.
 * Never creates, merges or rebinds an identity. Input stays in a root-only file. */
import { lstat, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export function parsePromotion(value: unknown) {
    const v = value as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v) ||
        Object.keys(v).sort().join(',') !== 'accountSubject,bindingId,staffUserId' ||
        ![v.bindingId, v.staffUserId].every(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) ||
        typeof v.accountSubject !== 'string' || !v.accountSubject || v.accountSubject.length > 255 || /\s/.test(v.accountSubject)) {
        throw new Error('Invalid private promotion request');
    }
    return {staffUserId: v.staffUserId as string, bindingId: v.bindingId as string, accountSubject: v.accountSubject};
}

export async function promoteEventManager(db: pg.PoolClient, input: ReturnType<typeof parsePromotion>, apply: boolean) {
    await db.query('BEGIN');
    try {
        const result = await db.query(`SELECT u.role, u.disabled_at, b.disabled_at AS binding_disabled
            FROM users u JOIN staff_account_bindings b ON b.staff_user_id=u.id
            WHERE u.id=$1 AND b.id=$2 AND b.account_subject=$3
            AND b.account_issuer='https://account.harmonicbeacon.com'
            FOR UPDATE OF u,b`, [input.staffUserId, input.bindingId, input.accountSubject]);
        const row = result.rows[0];
        if (result.rowCount !== 1 || row.disabled_at || row.binding_disabled ||
            !['OPERATOR', 'FACILITATOR_OP'].includes(row.role)) throw new Error('Current staff binding does not match promotion request');
        if (row.role === 'FACILITATOR_OP') { await db.query('ROLLBACK'); return 'already-enabled'; }
        if (!apply) { await db.query('ROLLBACK'); return 'would-enable'; }
        await db.query("UPDATE users SET role='FACILITATOR_OP', updated_at=now() WHERE id=$1 AND role='OPERATOR'", [input.staffUserId]);
        await db.query(`INSERT INTO audit_logs (id,action,target_type,target_id,reason,metadata,created_at)
            VALUES (gen_random_uuid(),'staff.event_manager.enabled','staff_user',$1,
            'explicit_owner_authorization', $2::jsonb, now())`, [input.staffUserId,
            JSON.stringify({previousRole:'OPERATOR',newRole:'FACILITATOR_OP',source:'promote-event-manager'})]);
        await db.query('COMMIT');
        return 'enabled';
    } catch (error) { await db.query('ROLLBACK'); throw error; }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) throw new Error('Only --apply is accepted');
    if (process.getuid?.() !== 0 || process.env.LIVE_PRODUCTION_STAFF_PROMOTION_ENABLED !== '1') throw new Error('Root and explicit promotion opt-in required');
    const path = '/run/harmonic-beacon/event-manager-promotion.json';
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1) throw new Error('Unsafe private request');
    const input = parsePromotion(JSON.parse(await readFile(path, 'utf8')));
    const url = new URL(process.env.DATABASE_URL || '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/beacon') throw new Error('Exact production database required');
    const pool = new pg.Pool({connectionString:url.href, max:1, connectionTimeoutMillis:5000, statement_timeout:10000});
    try { const db = await pool.connect(); try { console.log(await promoteEventManager(db,input,args[0]==='--apply')); } finally {db.release();} }
    finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(() => { console.error('Staff promotion refused; inspect private request and current binding.'); process.exitCode=1; });
}
