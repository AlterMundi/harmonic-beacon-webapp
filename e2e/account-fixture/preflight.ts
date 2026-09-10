import pg from 'pg';
import { requireAccountFixture } from './browser';

/** Read-only guard runs before any RP/media test is allowed to mutate fixtures. */
export default async function preflight() {
    requireAccountFixture();
    if (!process.env.E2E_ACCOUNT_INSTANCE) throw new Error('Use run.ts: private Account fixture instance marker is required');
    const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
    await db.connect();
    try {
        const { rows } = await db.query('select instance, issuer from navigation_account_fixture');
        if (rows.length !== 1 || rows[0].instance !== process.env.E2E_ACCOUNT_INSTANCE || rows[0].issuer !== process.env.E2E_ACCOUNT_ISSUER) throw new Error('Not this disposable Account fixture database; refusing tests');
    } finally { await db.end(); }
    const response = await fetch(`${process.env.E2E_ACCOUNT_ISSUER}/.well-known/openid-configuration`);
    if (!response.ok || (await response.json()).issuer !== process.env.E2E_ACCOUNT_ISSUER) throw new Error('Local external identity simulation unavailable');
}
