export async function runQualityAndRetention(pool) {
    const checks = [
        [`insert into ops.quality_results(check_name,source,status,observed_value,expected_value,details)
          select 'collector_clock_skew','collector',case when count(*)=0 then 'ok' else 'warning' end,count(*),0,
                 jsonb_build_object('window','1 hour','threshold_seconds',86400)
          from ingest.raw_events
          where received_at >= now()-interval '1 hour'
            and abs(extract(epoch from(received_at-occurred_at)))>86400`],
        [`insert into ops.quality_results(check_name,source,status,observed_value,expected_value,details)
          select 'canonical_projection_backlog','worker',case when count(*)=0 then 'ok' else 'error' end,count(*),0,
                 jsonb_build_object('minimum_age','5 minutes')
          from ingest.raw_events e
          left join ingest.projection_receipts r on r.event_id=e.event_id and r.projector='canonical-v1'
          where e.source<>'browser' and r.event_id is null and e.received_at<now()-interval '5 minutes'`],
        [`insert into ops.quality_results(check_name,source,status,observed_value,expected_value,details)
          select 'identity_links_without_account','identity',case when count(*)=0 then 'ok' else 'error' end,count(*),0,
                 jsonb_build_object('minimum_age','15 minutes')
          from identity_map.account_links l
          left join mart.account_facts a using(account_subject)
          where a.account_subject is null and l.valid_from<now()-interval '15 minutes'`],
        [`insert into ops.quality_results(check_name,source,status,observed_value,expected_value,details)
          select 'payments_without_membership','authority',case when count(*)=0 then 'ok' else 'error' end,count(*),0,'{}'
          from mart.payment_facts p
          left join mart.membership_snapshots m
            on m.source_system='authority' and m.source_key=p.membership_source_key
          where p.membership_source_key is not null and m.source_key is null`],
        [`insert into ops.quality_results(check_name,source,status,observed_value,expected_value,details)
          select 'invalid_listener_intervals','listener',case when count(*)=0 then 'ok' else 'error' end,count(*),0,'{}'
          from mart.listening_intervals where ended_at<=started_at`],
        [`insert into ops.quality_results(check_name,source,status,observed_value,expected_value,details)
          select 'invalid_live_intervals','live',case when count(*)=0 then 'ok' else 'error' end,count(*),0,
                 jsonb_build_object('maximum_hours',12)
          from mart.live_presence_intervals
          where ended_at<=started_at or ended_at-started_at>interval '12 hours'`],
    ];
    for (const [sql] of checks) await pool.query(sql);

    await pool.query(`insert into ops.storage_samples
        (database_bytes,raw_events,account_facts,listening_intervals,live_presence_intervals,membership_snapshots,payment_facts)
        select pg_database_size(current_database()),
          (select count(*) from ingest.raw_events),
          (select count(*) from mart.account_facts),
          (select count(*) from mart.listening_intervals),
          (select count(*) from mart.live_presence_intervals),
          (select count(*) from mart.membership_snapshots),
          (select count(*) from mart.payment_facts)`);

    await pool.query(`update ingest.raw_events set network_digest=null
        where received_at < now()-interval '30 days' and network_digest is not null`);
    await pool.query(`update ingest.raw_events set
        attribution=attribution-'fbclid'-'gclid'-'msclkid'-'ttclid',
        first_attribution=first_attribution-'fbclid'-'gclid'-'msclkid'-'ttclid',
        last_attribution=last_attribution-'fbclid'-'gclid'-'msclkid'-'ttclid'
        where received_at < now()-interval '90 days' and (
          attribution ?| array['fbclid','gclid','msclkid','ttclid'] or
          first_attribution ?| array['fbclid','gclid','msclkid','ttclid'] or
          last_attribution ?| array['fbclid','gclid','msclkid','ttclid'])`);
    await pool.query(`delete from ingest.raw_events where received_at < now()-interval '180 days'`);
    await pool.query(`delete from ops.quality_results where checked_at < now()-interval '180 days'`);
    await pool.query(`delete from ops.storage_samples where checked_at < now()-interval '400 days'`);
    await pool.query(`insert into ops.source_watermarks(source,last_attempt_at,last_success_at,lag_seconds,status,rows_read,rows_written,updated_at)
        select 'collector',now(),now(),coalesce(extract(epoch from(now()-max(received_at)))::int,0),'ok',count(*),count(*),now()
        from ingest.raw_events
        on conflict(source) do update set last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,
          lag_seconds=excluded.lag_seconds,status='ok',rows_read=excluded.rows_read,rows_written=excluded.rows_written,updated_at=now()`);
}

