import assert from 'node:assert/strict';
import test from 'node:test';

import pg from 'pg';

import { RECLASSIFY_BROWSER_TRAFFIC_SQL } from '../src/queries.mjs';
import { createStore } from '../src/store.mjs';

const connectionString = process.env.ANALYTICS_TEST_DATABASE_URL;
const postgresTest = connectionString ? test : test.skip;

postgresTest('PostgreSQL ingestion deduplicates retries by event id', async () => {
    const store = createStore(connectionString);
    const event = {
        event_id: '20000000-0000-4000-8000-000000000001', schema_version: 'hb.analytics.event.v1',
        event_name: 'page.viewed', occurred_at: '2026-08-29T04:00:00.000Z', source: 'browser',
        surface: 'home', environment: 'test', visitor_id: '20000000-0000-4000-8000-000000000002',
        session_id: '20000000-0000-4000-8000-000000000003', account_subject: null,
        page: { path: '/', title: 'Home', referrer: null, landing: '/' }, attribution: null,
        first_attribution: { utm_source: 'newsletter' }, last_attribution: { utm_source: 'meta' },
        device: null, traffic_class: 'test', properties: {},
    };
    const request = { countryCode: 'AR', regionCode: 'X', networkDigest: 'd'.repeat(64) };
    await store.pool.query('delete from ingest.raw_events where event_id=$1', [event.event_id]);
    assert.equal(await store.insert(event, request), true);
    assert.equal(await store.insert(event, request), false);
    const count = await store.pool.query('select count(*)::int as count from ingest.raw_events where event_id=$1', [event.event_id]);
    assert.equal(count.rows[0].count, 1);
    const touches = await store.pool.query('select first_attribution,last_attribution from ingest.raw_events where event_id=$1', [event.event_id]);
    assert.equal(touches.rows[0].first_attribution.utm_source, 'newsletter');
    assert.equal(touches.rows[0].last_attribution.utm_source, 'meta');
    await store.close();
});

postgresTest('interval views union overlapping tabs, nested intervals and reconnects', async () => {
    const pool = new pg.Pool({ connectionString });
    const account = 'a'.repeat(64);
    await pool.query("delete from mart.listening_intervals where source_system='test'");
    const rows = [
        ['one', '2026-08-29T10:00:00Z', '2026-08-29T10:10:00Z'],
        ['nested', '2026-08-29T10:02:00Z', '2026-08-29T10:05:00Z'],
        ['overlap', '2026-08-29T10:09:00Z', '2026-08-29T10:15:00Z'],
        ['reconnect', '2026-08-29T10:20:00Z', '2026-08-29T10:25:00Z'],
    ];
    for (const [key, start, end] of rows) await pool.query(`insert into mart.listening_intervals
        (source_system,source_key,account_subject,started_at,ended_at,source_category,access_class,environment,traffic_class)
        values('test',$1,$2,$3,$4,'beacon','founder','test','test')`, [key, account, start, end]);
    const result = await pool.query(`select duration_seconds from mart.listening_intervals_unioned
        where account_subject=$1 order by started_at`, [account]);
    assert.deepEqual(result.rows.map(row => Number(row.duration_seconds)), [900, 300]);
    await pool.end();
});

postgresTest('commercial facts reject negative and non-terminal pseudo payments', async () => {
    const pool = new pg.Pool({ connectionString });
    const base = ['test', 'e'.repeat(64), 'a'.repeat(64), 'paypal', 'USD', '2026-08-29T10:00:00Z', 'test', 'test'];
    await assert.rejects(pool.query(`insert into mart.payment_facts
        (source_system,source_key_digest,account_subject,provider,state,amount_minor,currency,occurred_at,traffic_class,environment)
        values($1,$2,$3,$4,'confirmed',-1,$5,$6,$7,$8)`, base));
    await assert.rejects(pool.query(`insert into mart.payment_facts
        (source_system,source_key_digest,account_subject,provider,state,amount_minor,currency,occurred_at,traffic_class,environment)
        values($1,$2,$3,$4,'approval_pending',500,$5,$6,$7,$8)`, base));
    await pool.end();
});

postgresTest('canonical account links reclassify matching browser traffic by time range', async () => {
    const pool = new pg.Pool({ connectionString });
    const eventId = '20000000-0000-4000-8000-000000000011';
    const visitorId = '20000000-0000-4000-8000-000000000012';
    await pool.query('delete from ingest.raw_events where event_id=$1', [eventId]);
    await pool.query('delete from identity_map.account_links where visitor_id=$1', [visitorId]);
    await pool.query(`insert into ingest.raw_events
        (event_id,schema_version,event_name,occurred_at,source,surface,environment,visitor_id,traffic_class)
        values($1,'hb.analytics.event.v1','page.viewed','2026-08-29T10:01:00Z','browser','home','production',$2,'real')`,
    [eventId, visitorId]);
    await pool.query(`insert into identity_map.account_links
        (account_subject,visitor_id,valid_from,link_reason,traffic_class)
        values($1,$2,'2026-08-29T10:00:00Z','login','internal')`, ['a'.repeat(64), visitorId]);
    const updated = await pool.query(RECLASSIFY_BROWSER_TRAFFIC_SQL);
    assert.equal(updated.rowCount >= 1, true);
    const result = await pool.query('select traffic_class from ingest.raw_events where event_id=$1', [eventId]);
    assert.equal(result.rows[0].traffic_class, 'internal');
    await pool.end();
});

postgresTest('current membership prefers the canonical authority over a later projection', async () => {
    const pool = new pg.Pool({ connectionString });
    const account = 'f'.repeat(64);
    await pool.query('delete from mart.membership_snapshots where account_subject=$1', [account]);
    await pool.query(`insert into mart.membership_snapshots
        (source_system,source_key,account_subject,revision,state,provider,currency,amount_minor,effective_at,paid_through,traffic_class,environment)
        values
        ('authority','canonical',$1,1,'ACTIVE','paypal','USD',500,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z','test','test'),
        ('listener-projection','projection',$1,99,'EXPIRED','paypal','USD',500,'2026-08-20T00:00:00Z',null,'test','test')`, [account]);
    const result = await pool.query('select source_system,state from mart.current_memberships where account_subject=$1', [account]);
    assert.deepEqual(result.rows, [{ source_system: 'authority', state: 'ACTIVE' }]);
    await pool.end();
});
