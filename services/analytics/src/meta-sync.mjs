import { createHash } from 'node:crypto';

import { MetaMarketingClient } from './meta.mjs';

export async function syncMetaSource({
    pool,
    sources,
    token = process.env.META_MARKETING_ACCESS_TOKEN,
    accountId = process.env.META_MARKETING_AD_ACCOUNT_ID,
    graphVersion = process.env.META_GRAPH_API_VERSION ?? 'v25.0',
    client = null,
    now = new Date(),
} = {}) {
    if (!client && (!token || !accountId)) {
        await pool.query(`insert into ops.source_watermarks(source,last_attempt_at,status,last_error_code,updated_at)
            values('meta',now(),'disabled','credentials_missing',now()) on conflict(source) do update set
            last_attempt_at=now(),status='disabled',last_error_code='credentials_missing',updated_at=now()`);
        await sources.resolveFailures('meta');
        return { status: 'disabled', read: 0, written: 0 };
    }
    const api = client ?? new MetaMarketingClient({ token, accountId, graphVersion });
    const until = now.toISOString().slice(0, 10);
    const since = new Date(now.getTime() - 36 * 86400000).toISOString().slice(0, 10);
    try {
        const [entities, insights] = await Promise.all([
            api.entities(now), api.insights({ since, until, observedAt: now }),
        ]);
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
            const count = entities.length + insights.length;
            await db.query(`insert into ops.source_watermarks(source,last_attempt_at,last_success_at,lag_seconds,status,rows_read,rows_written,last_error_code,updated_at)
                values('meta',now(),now(),0,'ok',$1,$1,null,now()) on conflict(source) do update set
                last_attempt_at=now(),last_success_at=now(),lag_seconds=0,status='ok',rows_read=$1,rows_written=$1,last_error_code=null,updated_at=now()`, [count]);
            await db.query('commit');
            await sources.resolveFailures('meta');
            return { status: 'ok', read: count, written: count };
        } catch (error) { await db.query('rollback'); throw error; } finally { db.release(); }
    } catch (error) {
        const code = createHash('sha256').update(String(error.code ?? error.name ?? 'meta_error')).digest('hex').slice(0, 32);
        await pool.query(`insert into ops.source_watermarks(source,last_attempt_at,status,last_error_code,updated_at)
            values('meta',now(),'error',$1,now()) on conflict(source) do update set last_attempt_at=now(),status='error',last_error_code=$1,updated_at=now()`, [code]);
        await sources.recordFailure('meta', code);
        return { status: 'error', read: 0, written: 0, errorCode: code };
    }
}

