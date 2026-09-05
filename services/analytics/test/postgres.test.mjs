import assert from 'node:assert/strict';
import test from 'node:test';

import pg from 'pg';

import { syncMetaSource } from '../src/meta-sync.mjs';
import { runQualityAndRetention } from '../src/quality.mjs';
import { RECLASSIFY_BROWSER_TRAFFIC_SQL } from '../src/queries.mjs';
import { SourceIngestor } from '../src/sources.mjs';
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
    await store.pool.query('delete from ingest.raw_events where event_id=$1', [event.event_id]);
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

postgresTest('commercial summaries subtract canonical refunds and reversals', async () => {
    const pool = new pg.Pool({ connectionString });
    const account = 'c'.repeat(64);
    await pool.query("delete from mart.payment_facts where source_system='test-commerce-summary'");
    for (const [key, state, amount] of [['paid', 'confirmed', 1000], ['refund', 'refunded', 250], ['chargeback', 'reversed', 300]]) {
        await pool.query(`insert into mart.payment_facts
            (source_system,source_key_digest,account_subject,provider,state,amount_minor,currency,occurred_at,traffic_class,environment)
            values('test-commerce-summary',$1,$2,'paypal',$3,$4,'USD','2026-08-29T10:00:00Z','test','test')`, [
            String(key).padEnd(64, 'd'), account, state, amount,
        ]);
    }
    const result = await pool.query(`select confirmed_payments,refunds,reversals,net_revenue_minor
        from mart.commerce_summary where metric_date='2026-08-29' and environment='test' and traffic_class='test' and currency='USD'`);
    assert.deepEqual(result.rows, [{ confirmed_payments: '1', refunds: '1', reversals: '1', net_revenue_minor: '450' }]);
    await pool.query("delete from mart.payment_facts where source_system='test-commerce-summary'");
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
    await pool.query('delete from ingest.raw_events where event_id=$1', [eventId]);
    await pool.query('delete from identity_map.account_links where visitor_id=$1', [visitorId]);
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

postgresTest('source health distinguishes disabled, unknown, stale, error and open retries', async () => {
    const pool = new pg.Pool({ connectionString });
    const prefix = 'test-health-';
    await pool.query('delete from ingest.dead_letters where source like $1', [`${prefix}%`]);
    await pool.query('delete from ops.source_watermarks where source like $1', [`${prefix}%`]);
    await pool.query(`insert into ops.source_watermarks(source,status,last_attempt_at,last_success_at,last_error_code)
        values
        ($1,'disabled',now(),null,'credentials_missing'),
        ($2,'unknown',now(),null,null),
        ($3,'ok',now()-interval '20 minutes',now()-interval '20 minutes',null),
        ($4,'error',now(),now()-interval '1 minute','opaque'),
        ($5,'ok',now(),now(),null)`, [
        `${prefix}disabled`, `${prefix}unknown`, `${prefix}stale`, `${prefix}error`, `${prefix}ok`,
    ]);
    await pool.query(`insert into ingest.dead_letters(source,source_key_digest,error_code)
        values($1,$2,'opaque')`, [`${prefix}error`, 'd'.repeat(64)]);
    const rows = await pool.query(`select source,display_state,open_dead_letters from mart.source_health
        where source like $1 order by source`, [`${prefix}%`]);
    assert.deepEqual(rows.rows.map(row => [
        row.source.slice(prefix.length), row.display_state, Number(row.open_dead_letters),
    ]), [
        ['disabled', 'disabled', 0], ['error', 'error', 1], ['ok', 'ok', 0],
        ['stale', 'stale', 0], ['unknown', 'unknown', 0],
    ]);
    await pool.query('delete from ingest.dead_letters where source like $1', [`${prefix}%`]);
    await pool.query('delete from ops.source_watermarks where source like $1', [`${prefix}%`]);
    await pool.end();
});

postgresTest('source retry failures are deduplicated, backed off and resolved', async () => {
    const pool = new pg.Pool({ connectionString });
    const source = 'test-retry-source';
    await pool.query('delete from ingest.dead_letters where source=$1', [source]);
    const ingestor = new SourceIngestor({
        analyticsPool: pool, identitySecret: 'test-identity-secret-with-32-characters', urls: {},
    });
    await ingestor.recordFailure(source, 'opaque_error');
    await ingestor.recordFailure(source, 'opaque_error');
    const failed = await pool.query(`select attempts,retry_after>last_failed_at retry_scheduled,resolved_at
        from ingest.dead_letters where source=$1`, [source]);
    assert.deepEqual(failed.rows, [{ attempts: 2, retry_scheduled: true, resolved_at: null }]);
    await ingestor.resolveFailures(source);
    const resolved = await pool.query('select resolved_at is not null resolved from ingest.dead_letters where source=$1', [source]);
    assert.equal(resolved.rows[0].resolved, true);
    await pool.query('delete from ingest.dead_letters where source=$1', [source]);
    await ingestor.close();
    await pool.end();
});

postgresTest('Meta fixture sync projects and idempotently updates campaign delivery', async () => {
    const pool = new pg.Pool({ connectionString });
    const entityId = 'fixture-campaign-474';
    await pool.query("delete from mart.campaign_insights where provider='meta' and entity_id=$1", [entityId]);
    await pool.query("delete from mart.campaign_entities where provider='meta' and entity_id=$1", [entityId]);
    await pool.query("delete from ingest.dead_letters where source='meta'");
    await pool.query("delete from ops.source_watermarks where source='meta'");
    let resolved = 0;
    const sources = {
        resolveFailures: async () => { resolved += 1; },
        recordFailure: async () => assert.fail('fixture sync must not fail'),
    };
    const fixture = {
        entities: async () => [{
            provider: 'meta', entityType: 'campaign', entityId, parentId: null, name: 'Fixture campaign',
            configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE', objective: 'OUTCOME_TRAFFIC',
            startsAt: '2026-08-01T00:00:00Z', endsAt: null, accountCurrency: 'USD',
            accountTimezone: 'America/Argentina/Buenos_Aires', observedAt: '2026-08-29T12:00:00Z', rawDigest: 'a'.repeat(64),
        }],
        insights: async ({ since, until }) => [{
            provider: 'meta', entityType: 'campaign', entityId, dateStart: since, dateStop: until,
            attributionWindow: 'default', currency: 'USD', spendMinor: 1234, impressions: 2000,
            reach: 1500, frequency: 1.3333, clicks: 42, ctr: 2.1, cpcMinor: 29, cpmMinor: 617,
            actions: { link_click: 42 }, observedAt: '2026-08-29T12:00:00Z',
        }],
    };
    const first = await syncMetaSource({ pool, sources, client: fixture, now: new Date('2026-08-29T12:00:00Z') });
    const second = await syncMetaSource({ pool, sources, client: fixture, now: new Date('2026-08-29T12:05:00Z') });
    assert.deepEqual(first, { status: 'ok', read: 2, written: 2 });
    assert.deepEqual(second, { status: 'ok', read: 2, written: 2 });
    assert.equal(resolved, 2);
    const delivery = await pool.query(`select configured_status,effective_status,delivering,spend_minor,impressions,clicks
        from mart.campaign_delivery where provider='meta' and entity_id=$1`, [entityId]);
    assert.deepEqual(delivery.rows, [{
        configured_status: 'ACTIVE', effective_status: 'ACTIVE', delivering: true,
        spend_minor: '1234', impressions: '2000', clicks: '42',
    }]);
    const counts = await pool.query(`select
        (select count(*)::int from mart.campaign_entities where provider='meta' and entity_id=$1) entities,
        (select count(*)::int from mart.campaign_insights where provider='meta' and entity_id=$1) insights`, [entityId]);
    assert.deepEqual(counts.rows, [{ entities: 1, insights: 1 }]);
    await pool.query("delete from mart.campaign_insights where provider='meta' and entity_id=$1", [entityId]);
    await pool.query("delete from mart.campaign_entities where provider='meta' and entity_id=$1", [entityId]);
    await pool.query("delete from ops.source_watermarks where source='meta'");
    await pool.end();
});

postgresTest('quality run records canonical integrity and storage samples', async () => {
    const pool = new pg.Pool({ connectionString });
    const names = [
        'collector_clock_skew', 'canonical_projection_backlog', 'identity_links_without_account',
        'payments_without_membership', 'invalid_listener_intervals', 'invalid_live_intervals',
    ];
    await pool.query('delete from ops.quality_results where check_name=any($1::text[])', [names]);
    const before = new Date();
    await runQualityAndRetention(pool);
    const quality = await pool.query(`select check_name,status,observed_value::int observed
        from mart.latest_quality_results where check_name=any($1::text[]) order by check_name`, [names]);
    assert.equal(quality.rowCount, names.length);
    assert.equal(quality.rows.every(row => row.status === 'ok' && row.observed === 0), true);
    const storage = await pool.query(`select database_bytes>0 valid_size,raw_events>=0 valid_events
        from ops.storage_samples where checked_at >= $1 order by checked_at desc limit 1`, [before]);
    assert.deepEqual(storage.rows, [{ valid_size: true, valid_events: true }]);
    await pool.query('delete from ops.quality_results where check_name=any($1::text[])', [names]);
    await pool.query('delete from ops.storage_samples where checked_at >= $1', [before]);
    await pool.end();
});
