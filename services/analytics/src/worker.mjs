import { createHash } from 'node:crypto';
import pg from 'pg';

import { MetaMarketingClient } from './meta.mjs';
import { RECLASSIFY_BROWSER_TRAFFIC_SQL } from './queries.mjs';
import { SourceIngestor } from './sources.mjs';
import { classifyLinkedTraffic } from './traffic.mjs';

const { Pool } = pg;
const connectionString = process.env.ANALYTICS_DATABASE_ADMIN_URL ?? process.env.ANALYTICS_DATABASE_URL;
if (!connectionString) throw new Error('ANALYTICS_DATABASE_URL is required');
const pool = new Pool({ connectionString, max: 3, application_name: 'hb-analytics-worker' });
const intervalMs = Math.max(5000, Number(process.env.ANALYTICS_WORKER_INTERVAL_MS ?? 30000));
const sources = new SourceIngestor({ analyticsPool: pool });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });

function property(event, key, fallback = null) {
    const value = event.properties?.[key];
    return value === undefined ? fallback : value;
}

async function projectBatch(limit = 500) {
    const client = await pool.connect();
    try {
        await client.query('begin');
        const events = await client.query({
            text: `select e.* from ingest.raw_events e
                   left join ingest.projection_receipts r on r.event_id=e.event_id and r.projector='canonical-v1'
                   where r.event_id is null and e.source <> 'browser'
                   order by e.received_at, e.event_id limit $1 for update of e skip locked`,
            values: [limit],
        });
        for (const event of events.rows) {
            if (event.event_name === 'identity.linked' && event.account_subject && event.visitor_id) {
                const trafficClass = classifyLinkedTraffic(
                    event.account_subject,
                    event.traffic_class,
                    sources.internal,
                );
                await client.query(`update identity_map.account_links set valid_to=$1
                    where visitor_id=$2 and valid_to is null and account_subject<>$3 and valid_from<$1`, [
                    event.occurred_at, event.visitor_id, event.account_subject,
                ]);
                await client.query(`insert into identity_map.account_links
                    (account_subject, visitor_id, valid_from, link_reason, source_event_id, traffic_class)
                    values ($1,$2,$3,$4,$5,$6) on conflict do nothing`, [
                    event.account_subject, event.visitor_id, event.occurred_at,
                    property(event, 'link_reason', 'login'), event.event_id, trafficClass,
                ]);
            } else if (event.event_name === 'account.created' && event.account_subject) {
                await client.query(`insert into mart.account_facts
                    (source_system,source_key_digest,account_subject,created_at,auth_method,traffic_class,environment)
                    values ($1,$2,$3,$4,$5,$6,$7)
                    on conflict (source_system,source_key_digest) do update set
                    account_subject=excluded.account_subject, auth_method=coalesce(excluded.auth_method,mart.account_facts.auth_method), ingested_at=now()`, [
                    event.source, property(event, 'source_key_digest'), event.account_subject,
                    event.occurred_at, property(event, 'auth_method'), event.traffic_class, event.environment,
                ]);
            } else if (event.event_name === 'account.verified' && event.account_subject) {
                await client.query(`update mart.account_facts set verified_at=$1, ingested_at=now()
                    where account_subject=$2 and (verified_at is null or verified_at>$1)`, [event.occurred_at, event.account_subject]);
            } else if (event.event_name === 'listener.interval_settled' && event.account_subject) {
                await client.query(`insert into mart.listening_intervals
                    (source_system,source_key,account_subject,device_subject,started_at,ended_at,source_category,access_class,environment,traffic_class)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing`, [
                    event.source, property(event, 'source_key'), event.account_subject, property(event, 'device_subject'),
                    property(event, 'started_at'), property(event, 'ended_at'), property(event, 'source_category', 'unknown'),
                    property(event, 'access_class'), event.environment, event.traffic_class,
                ]);
            } else if (event.event_name === 'live.presence_settled') {
                await client.query(`insert into mart.live_presence_intervals
                    (source_system,source_key,event_subject,person_subject,account_subject,role,started_at,ended_at,reconnect_count,end_reason,is_staff,is_test,environment,traffic_class)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict do nothing`, [
                    event.source, property(event, 'source_key'), property(event, 'event_subject'), property(event, 'person_subject'),
                    event.account_subject, property(event, 'role'), property(event, 'started_at'), property(event, 'ended_at'),
                    property(event, 'reconnect_count', 0), property(event, 'end_reason'), property(event, 'is_staff', false),
                    property(event, 'is_test', false), event.environment, event.traffic_class,
                ]);
            } else if (event.event_name === 'membership.snapshot' && event.account_subject) {
                await client.query(`insert into mart.membership_snapshots
                    (source_system,source_key,account_subject,revision,state,provider,offer_code,currency,amount_minor,effective_at,paid_through,terminal_at,traffic_class,environment)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                    on conflict (source_system,source_key,revision) do nothing`, [
                    event.source, property(event, 'source_key'), event.account_subject, property(event, 'revision'),
                    property(event, 'state'), property(event, 'provider'), property(event, 'offer_code'),
                    property(event, 'currency'), property(event, 'amount_minor'), event.occurred_at,
                    property(event, 'paid_through'), property(event, 'terminal_at'), event.traffic_class, event.environment,
                ]);
            } else if (['payment.confirmed', 'payment.refunded', 'payment.reversed'].includes(event.event_name) && event.account_subject) {
                await client.query(`insert into mart.payment_facts
                    (source_system,source_key_digest,account_subject,membership_source_key,provider,state,amount_minor,currency,occurred_at,traffic_class,environment)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`, [
                    event.source, property(event, 'source_key_digest'), event.account_subject, property(event, 'membership_source_key'),
                    property(event, 'provider'), event.event_name.split('.')[1], property(event, 'amount_minor'),
                    property(event, 'currency'), event.occurred_at, event.traffic_class, event.environment,
                ]);
            }
            await client.query('insert into ingest.projection_receipts(event_id,projector) values ($1,$2) on conflict do nothing', [event.event_id, 'canonical-v1']);
        }
        await client.query('commit');
        return events.rowCount;
    } catch (error) {
        await client.query('rollback');
        throw error;
    } finally {
        client.release();
    }
}

async function refreshDaily(windowDays = 2) {
    const client = await pool.connect();
    try {
        await client.query('begin');
        // Browser payloads may only self-classify as real/test. Once the
        // authenticated server links a visitor, apply the canonical class to
        // matching time ranges. This also catches events arriving after the
        // link and keeps internal traffic out of commercial defaults.
        await client.query(RECLASSIFY_BROWSER_TRAFFIC_SQL);
        // Raw browser events retain 180 days. Refresh only that mutable window
        // so daily aggregates older than raw retention remain available.
        await client.query(`delete from mart.daily_metrics where metric_date >= current_date - $1::int`, [windowDays]);
        await client.query(`insert into mart.daily_metrics
            (metric_date,environment,traffic_class,surface,visitors,sessions,pageviews,currency)
            select occurred_at::date,environment,traffic_class,surface,
                   count(distinct visitor_id),count(distinct session_id),count(*) filter(where event_name='page.viewed'),'N/A'
            from ingest.raw_events where source='browser' and occurred_at >= current_date - $1::int
            group by 1,2,3,4`, [windowDays]);
        await client.query(`delete from mart.acquisition_daily where metric_date >= current_date - $1::int`, [windowDays]);
        await client.query(`insert into mart.acquisition_daily
            (metric_date,environment,traffic_class,source,medium,campaign,first_source,first_medium,first_campaign,
             first_referrer,last_referrer,first_landing,last_landing,visitors,sessions,pageviews)
            select occurred_at::date,environment,traffic_class,
              coalesce(nullif(last_attribution->>'utm_source',''),nullif(page->>'referrer',''),'direct'),
              coalesce(nullif(last_attribution->>'utm_medium',''),'unknown'),
              coalesce(nullif(last_attribution->>'utm_campaign',''),'unattributed'),
              coalesce(nullif(first_attribution->>'utm_source',''),nullif(page->>'referrer',''),'direct'),
              coalesce(nullif(first_attribution->>'utm_medium',''),'unknown'),
              coalesce(nullif(first_attribution->>'utm_campaign',''),'unattributed'),
              coalesce(nullif(first_attribution->>'referrer',''),'direct'),
              coalesce(nullif(last_attribution->>'referrer',''),'direct'),
              coalesce(nullif(first_attribution->>'landing',''),'unknown'),
              coalesce(nullif(last_attribution->>'landing',''),'unknown'),
              count(distinct visitor_id),count(distinct session_id),count(*) filter(where event_name='page.viewed')
            from ingest.raw_events where source='browser' and occurred_at >= current_date - $1::int
            group by 1,2,3,4,5,6,7,8,9,10,11,12,13`, [windowDays]);
        await client.query(`insert into mart.daily_metrics
            (metric_date,environment,traffic_class,surface,accounts_created,accounts_verified,currency)
            select created_at::date,environment,traffic_class,'account',count(*),count(*) filter(where verified_at is not null),'N/A'
            from mart.account_facts where created_at >= current_date - $1::int group by 1,2,3
            on conflict (metric_date,environment,traffic_class,surface,currency) do update set
              accounts_created=excluded.accounts_created,accounts_verified=excluded.accounts_verified,refreshed_at=now()`, [windowDays]);
        await client.query(`insert into mart.daily_metrics
            (metric_date,environment,traffic_class,surface,listeners,listening_seconds,currency)
            select started_at::date,environment,traffic_class,'listen',count(distinct account_subject),sum(duration_seconds),'N/A'
            from mart.listening_intervals_unioned where started_at >= current_date - $1::int group by 1,2,3
            on conflict (metric_date,environment,traffic_class,surface,currency) do update set
              listeners=excluded.listeners,listening_seconds=excluded.listening_seconds,refreshed_at=now()`, [windowDays]);
        await client.query(`insert into mart.daily_metrics
            (metric_date,environment,traffic_class,surface,attendees,attendee_seconds,currency)
            select started_at::date,environment,traffic_class,'live',count(distinct person_subject),sum(duration_seconds),'N/A'
            from mart.live_presence_intervals_unioned where not is_staff and not is_test and started_at >= current_date - $1::int group by 1,2,3
            on conflict (metric_date,environment,traffic_class,surface,currency) do update set
              attendees=excluded.attendees,attendee_seconds=excluded.attendee_seconds,refreshed_at=now()`, [windowDays]);
        await client.query(`insert into mart.daily_metrics
            (metric_date,environment,traffic_class,surface,payments_confirmed,revenue_minor,currency)
            select occurred_at::date,environment,traffic_class,'commerce',count(*) filter(where state='confirmed'),
                   sum(case when state='confirmed' then amount_minor when state in ('refunded','reversed') then -amount_minor else 0 end),currency
            from mart.payment_facts where occurred_at >= current_date - $1::int group by 1,2,3,7
            on conflict (metric_date,environment,traffic_class,surface,currency) do update set
              payments_confirmed=excluded.payments_confirmed,revenue_minor=excluded.revenue_minor,refreshed_at=now()`, [windowDays]);
        await client.query('commit');
    } catch (error) {
        await client.query('rollback');
        throw error;
    } finally { client.release(); }
}

async function qualityAndRetention() {
    await pool.query(`insert into ops.quality_results(check_name,source,status,observed_value,expected_value,details)
        select 'collector_clock_skew','collector',case when count(*)=0 then 'ok' else 'warning' end,count(*),0,'{}'
        from ingest.raw_events where received_at >= now()-interval '1 hour' and abs(extract(epoch from(received_at-occurred_at)))>86400`);
    await pool.query(`update ingest.raw_events set network_digest=null where received_at < now()-interval '30 days' and network_digest is not null`);
    await pool.query(`update ingest.raw_events set
        attribution=attribution-'fbclid'-'gclid'-'msclkid'-'ttclid',
        first_attribution=first_attribution-'fbclid'-'gclid'-'msclkid'-'ttclid',
        last_attribution=last_attribution-'fbclid'-'gclid'-'msclkid'-'ttclid'
        where received_at < now()-interval '90 days' and (
          attribution ?| array['fbclid','gclid','msclkid','ttclid'] or
          first_attribution ?| array['fbclid','gclid','msclkid','ttclid'] or
          last_attribution ?| array['fbclid','gclid','msclkid','ttclid'])`);
    await pool.query(`delete from ingest.raw_events where received_at < now()-interval '180 days'`);
    await pool.query(`insert into ops.source_watermarks(source,last_attempt_at,last_success_at,lag_seconds,status,rows_read,rows_written,updated_at)
        select 'collector',now(),now(),coalesce(extract(epoch from(now()-max(received_at)))::int,0),'ok',count(*),count(*),now()
        from ingest.raw_events
        on conflict(source) do update set last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,
          lag_seconds=excluded.lag_seconds,status='ok',rows_read=excluded.rows_read,rows_written=excluded.rows_written,updated_at=now()`);
}

async function syncMeta() {
    const token = process.env.META_MARKETING_ACCESS_TOKEN;
    const accountId = process.env.META_MARKETING_AD_ACCOUNT_ID;
    if (!token || !accountId) {
        await pool.query(`insert into ops.source_watermarks(source,last_attempt_at,status,last_error_code,updated_at)
            values('meta',now(),'disabled','credentials_missing',now()) on conflict(source) do update set
            last_attempt_at=now(),status='disabled',last_error_code='credentials_missing',updated_at=now()`);
        await sources.resolveFailures('meta');
        return;
    }
    const client = new MetaMarketingClient({ token, accountId, graphVersion: process.env.META_GRAPH_API_VERSION ?? 'v25.0' });
    const now = new Date();
    const until = now.toISOString().slice(0, 10);
    const since = new Date(now.getTime() - 36 * 86400000).toISOString().slice(0, 10);
    try {
        const [entities, insights] = await Promise.all([client.entities(now), client.insights({ since, until, observedAt: now })]);
        const db = await pool.connect();
        try {
            await db.query('begin');
            for (const row of entities) await db.query(`insert into mart.campaign_entities
                (provider,entity_type,entity_id,parent_id,name,configured_status,effective_status,objective,starts_at,ends_at,account_currency,account_timezone,observed_at,raw_digest)
                values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                on conflict(provider,entity_type,entity_id) do update set parent_id=excluded.parent_id,name=excluded.name,
                configured_status=excluded.configured_status,effective_status=excluded.effective_status,objective=excluded.objective,
                starts_at=excluded.starts_at,ends_at=excluded.ends_at,account_currency=excluded.account_currency,
                account_timezone=excluded.account_timezone,observed_at=excluded.observed_at,raw_digest=excluded.raw_digest`, [
                row.provider, row.entityType, row.entityId, row.parentId, row.name,
                row.configuredStatus, row.effectiveStatus, row.objective, row.startsAt, row.endsAt,
                row.accountCurrency, row.accountTimezone, row.observedAt, row.rawDigest,
            ]);
            for (const row of insights) await db.query(`insert into mart.campaign_insights
                (provider,entity_type,entity_id,date_start,date_stop,attribution_window,currency,spend_minor,impressions,reach,frequency,clicks,ctr,cpc_minor,cpm_minor,actions,observed_at)
                values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
                on conflict(provider,entity_type,entity_id,date_start,date_stop,attribution_window) do update set
                currency=excluded.currency,spend_minor=excluded.spend_minor,impressions=excluded.impressions,reach=excluded.reach,
                frequency=excluded.frequency,clicks=excluded.clicks,ctr=excluded.ctr,cpc_minor=excluded.cpc_minor,
                cpm_minor=excluded.cpm_minor,actions=excluded.actions,observed_at=excluded.observed_at`, [
                row.provider,row.entityType,row.entityId,row.dateStart,row.dateStop,row.attributionWindow,row.currency,
                row.spendMinor,row.impressions,row.reach,row.frequency,row.clicks,row.ctr,row.cpcMinor,row.cpmMinor,
                JSON.stringify(row.actions),row.observedAt,
            ]);
            await db.query(`insert into ops.source_watermarks(source,last_attempt_at,last_success_at,lag_seconds,status,rows_read,rows_written,last_error_code,updated_at)
                values('meta',now(),now(),0,'ok',$1,$2,null,now()) on conflict(source) do update set
                last_attempt_at=now(),last_success_at=now(),lag_seconds=0,status='ok',rows_read=$1,rows_written=$2,last_error_code=null,updated_at=now()`, [entities.length + insights.length, entities.length + insights.length]);
            await db.query('commit');
            await sources.resolveFailures('meta');
        } catch (error) { await db.query('rollback'); throw error; } finally { db.release(); }
    } catch (error) {
        const code = createHash('sha256').update(String(error.code ?? error.name ?? 'meta_error')).digest('hex').slice(0, 32);
        await pool.query(`insert into ops.source_watermarks(source,last_attempt_at,status,last_error_code,updated_at)
            values('meta',now(),'error',$1,now()) on conflict(source) do update set last_attempt_at=now(),status='error',last_error_code=$1,updated_at=now()`, [code]);
        await sources.recordFailure('meta', code);
    }
}

let lastMeta = 0;
let lastMaintenance = 0;
let lastSources = 0;
let lastDaily = 0;
let lastFullDaily = 0;
while (!stopping) {
    try {
        if (Date.now() - lastSources > 300000) { await sources.syncAll(); lastSources = Date.now(); }
        await projectBatch();
        if (Date.now() - lastFullDaily > 86400000) {
            await refreshDaily(180); lastFullDaily = Date.now(); lastDaily = lastFullDaily;
        } else if (Date.now() - lastDaily > 300000) {
            await refreshDaily(2); lastDaily = Date.now();
        }
        if (Date.now() - lastMaintenance > 3600000) { await qualityAndRetention(); lastMaintenance = Date.now(); }
        if (Date.now() - lastMeta > 900000) { await syncMeta(); lastMeta = Date.now(); }
        await pool.query(`insert into ops.source_watermarks(source,last_attempt_at,last_success_at,lag_seconds,status,rows_read,rows_written,last_error_code,updated_at)
            values('worker',now(),now(),0,'ok',0,0,null,now()) on conflict(source) do update set
            last_attempt_at=now(),last_success_at=now(),lag_seconds=0,status='ok',last_error_code=null,updated_at=now()`);
        await sources.resolveFailures('worker');
    } catch (error) {
        const code = createHash('sha256').update(String(error.code ?? error.name ?? 'worker_error')).digest('hex').slice(0, 32);
        await pool.query(`insert into ops.source_watermarks(source,last_attempt_at,status,last_error_code,updated_at)
            values('worker',now(),'error',$1,now()) on conflict(source) do update set
            last_attempt_at=now(),status='error',last_error_code=$1,updated_at=now()`, [code]).catch(() => {});
        await sources.recordFailure('worker', code).catch(() => {});
        process.stderr.write(`${JSON.stringify({ level: 'error', component: 'analytics-worker', code })}\n`);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
}

await sources.close();
await pool.end();
