const environments = new Set(['production', 'staging', 'development', 'test']);
const trafficClasses = new Set(['real', 'internal', 'synthetic', 'test', 'unknown']);

export function dashboardFilters(input = {}) {
    const end = input.end ? new Date(input.end) : new Date();
    const start = input.start ? new Date(input.start) : new Date(end.getTime() - 30 * 86400000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end - start > 2 * 366 * 86400000) {
        throw new Error('invalid_date_range');
    }
    const environment = environments.has(input.environment) ? input.environment : 'production';
    const traffic = Array.isArray(input.traffic) ? input.traffic.filter(value => trafficClasses.has(value)) : ['real'];
    if (traffic.length === 0) throw new Error('invalid_traffic_filter');
    const timezone = typeof input.timezone === 'string' && input.timezone.length <= 64 ? input.timezone : 'UTC';
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new Error('invalid_timezone'); }
    return { start, end, environment, traffic: [...new Set(traffic)], timezone };
}

export const metricDefinitions = {
    visitors: { definition: 'Distinct first-party visitor IDs observed by the browser collector.', source: 'ingest.raw_events' },
    sessions: { definition: 'Distinct 30-minute first-party browser sessions.', source: 'ingest.raw_events' },
    accounts: { definition: 'Canonical accounts created in Account; verification is a server-side fact.', source: 'mart.account_facts' },
    listening_seconds: { definition: 'Union of server-observed Listener intervals across tabs and devices.', source: 'mart.listening_intervals_unioned / #308' },
    attendee_seconds: { definition: 'Union of authenticated Live presence intervals; Staff and test events excluded by default.', source: 'mart.live_presence_intervals_unioned' },
    revenue: { definition: 'Confirmed provider payment events less confirmed refunds; clicks and pending checkouts excluded.', source: 'mart.payment_facts' },
    mrr: { definition: 'Monthly recurring amount of current paid-through memberships; shown by currency without FX conversion.', source: 'mart.current_memberships' },
    funnel: { definition: 'Unique people or browser visitors reaching each server/browser-owned stage in the selected window.', source: 'ingest.raw_events + canonical marts' },
    delivering: { definition: 'Configured campaign with recent non-zero impressions or spend.', source: 'Meta Marketing API campaign insights' },
};

export async function queryDashboard(pool, rawFilters = {}) {
    const filters = dashboardFilters(rawFilters);
    const params = [filters.start, filters.end, filters.environment, filters.traffic];
    const scope = `occurred_at >= $1 and occurred_at < $2 and environment=$3 and traffic_class=any($4::text[])`;
    const [web, accounts, listen, live, commerce, acquisition, geography, devices, events, memberships, campaigns, health, series, cohorts, pages, listenerActivity, funnel, lifecycle] = await Promise.all([
        pool.query(`select count(distinct visitor_id)::bigint visitors,count(distinct session_id)::bigint sessions,
            count(*) filter(where event_name='page.viewed')::bigint pageviews from ingest.raw_events where ${scope}`, params),
        pool.query(`select count(*)::bigint created,count(*) filter(where verified_at is not null)::bigint verified,
            count(*) filter(where last_active_at >= $1 and last_active_at < $2)::bigint active,
            (select coalesce(jsonb_object_agg(method,method_count),'{}') from (
              select coalesce(auth_method,'unknown') method,count(*) method_count from mart.account_facts
              where created_at >= $1 and created_at < $2 and environment=$3 and traffic_class=any($4::text[])
              group by coalesce(auth_method,'unknown')) methods_q) methods
            from mart.account_facts where created_at >= $1 and created_at < $2
              and environment=$3 and traffic_class=any($4::text[])`, params),
        pool.query(`select count(distinct account_subject)::bigint listeners,
            coalesce(sum(extract(epoch from least(ended_at,$2)-greatest(started_at,$1))),0)::bigint listening_seconds
            from mart.listening_intervals_unioned where started_at < $2 and ended_at > $1 and environment=$3 and traffic_class=any($4::text[])`, params),
        pool.query(`select count(distinct person_subject)::bigint attendees,
            coalesce(sum(extract(epoch from least(ended_at,$2)-greatest(started_at,$1))),0)::bigint attendee_seconds
            from mart.live_presence_intervals_unioned where started_at < $2 and ended_at > $1 and environment=$3
              and traffic_class=any($4::text[]) and not is_staff and not is_test`, params),
        pool.query(`select currency,count(*) filter(where state='confirmed')::bigint confirmed,
            count(*) filter(where state='refunded')::bigint refunds,
            coalesce(sum(case when state='confirmed' then amount_minor when state='refunded' then -amount_minor else 0 end),0)::bigint net_revenue_minor
            from mart.payment_facts where ${scope} group by currency order by currency`, params),
        pool.query(`select source,medium,campaign,first_source,first_medium,first_campaign,
            sum(visitors)::bigint visitors,sum(sessions)::bigint sessions,sum(pageviews)::bigint pageviews
            from mart.acquisition where metric_date >= ($1 at time zone $5)::date and metric_date <= ($2 at time zone $5)::date
              and environment=$3 and traffic_class=any($4::text[]) group by 1,2,3,4,5,6 order by visitors desc limit 100`, [...params, filters.timezone]),
        pool.query(`select coalesce(country_code,'unknown') country,coalesce(region_code,'unknown') region,
            count(distinct visitor_id)::bigint visitors from ingest.raw_events where ${scope} group by 1,2 order by visitors desc limit 100`, params),
        pool.query(`select coalesce(device->>'class','unknown') class,coalesce(device->>'browser','unknown') browser,
            coalesce(device->>'os','unknown') os,count(distinct visitor_id)::bigint visitors
            from ingest.raw_events where ${scope} group by 1,2,3 order by visitors desc limit 100`, params),
        pool.query(`with spans as (select event_subject,count(distinct person_subject)::bigint attendees,
              min(started_at) first_entry,max(ended_at) last_exit,sum(duration_seconds)::bigint attendee_seconds,
              count(*)::bigint presence_spans from mart.live_presence_intervals_unioned
              where started_at < $2 and ended_at > $1 and environment=$3 and traffic_class=any($4::text[])
                and not is_staff and not is_test group by event_subject), raw as (
              select event_subject,sum(reconnect_count)::bigint reconnects,
              count(*) filter(where end_reason='heartbeat_timeout')::bigint network_or_crash_exits
              from mart.live_presence_intervals where started_at < $2 and ended_at > $1 and environment=$3
                and traffic_class=any($4::text[]) and not is_staff and not is_test group by event_subject)
            select spans.*,coalesce(raw.reconnects,0) reconnects,coalesce(raw.network_or_crash_exits,0) network_or_crash_exits
            from spans left join raw using(event_subject) order by attendees desc`, params),
        pool.query(`select state,provider,currency,count(*)::bigint memberships,
            count(*) filter(where paid_through >= now())::bigint paid_through_current
            from mart.current_memberships where environment=$1 and traffic_class=any($2::text[])
            group by 1,2,3 order by memberships desc`, [filters.environment, filters.traffic]),
        pool.query(`select entity_type,entity_id,name,configured_status,effective_status,delivering,date_start,date_stop,
            account_currency,spend_minor,impressions,reach,frequency,clicks,ctr,cpc_minor,cpm_minor,actions
            from mart.campaign_delivery where date_start is null or (date_start <= $2::date and date_stop >= $1::date)
            order by delivering desc,impressions desc nulls last,name limit 500`, [filters.start, filters.end]),
        pool.query('select * from mart.source_health order by source'),
        pool.query(`select metric_date,surface,sum(visitors)::bigint visitors,sum(sessions)::bigint sessions,
            sum(pageviews)::bigint pageviews,sum(accounts_created)::bigint accounts_created,
            sum(accounts_verified)::bigint accounts_verified,sum(listeners)::bigint listeners,
            sum(listening_seconds)::bigint listening_seconds,sum(attendees)::bigint attendees,
            sum(attendee_seconds)::bigint attendee_seconds,sum(payments_confirmed)::bigint payments_confirmed,
            sum(revenue_minor)::bigint revenue_minor,currency from mart.daily_metrics
            where metric_date >= ($1 at time zone $5)::date and metric_date <= ($2 at time zone $5)::date
              and environment=$3 and traffic_class=any($4::text[]) group by metric_date,surface,currency order by metric_date,surface`, [...params, filters.timezone]),
        pool.query(`with firsts as (select account_subject,min(started_at)::date cohort_date from mart.listening_intervals_unioned
              where environment=$3 and traffic_class=any($4::text[]) group by account_subject), activity as (
              select distinct account_subject,started_at::date activity_date from mart.listening_intervals_unioned
              where started_at < $2 and ended_at > $1 and environment=$3 and traffic_class=any($4::text[]))
            select cohort_date,(activity_date-cohort_date) day_number,count(distinct activity.account_subject)::bigint listeners
            from firsts join activity using(account_subject) where cohort_date >= $1::date and cohort_date < $2::date
            group by 1,2 order by 1,2`, params),
        pool.query(`select surface,page->>'path' path,coalesce(page->>'landing','unknown') landing,
            coalesce(page->>'referrer','direct') referrer,count(*) filter(where event_name='page.viewed')::bigint pageviews,
            count(distinct visitor_id)::bigint visitors,count(distinct session_id)::bigint sessions
            from ingest.raw_events where ${scope} and source='browser' and event_name='page.viewed'
            group by 1,2,3,4 order by pageviews desc limit 500`, params),
        pool.query(`select account_subject,count(*)::bigint visits,sum(duration_seconds)::bigint listening_seconds,
            avg(duration_seconds)::bigint average_visit_seconds,min(started_at) first_listen,max(ended_at) last_listen,
            count(distinct started_at::date)::bigint active_days
            from mart.listening_intervals_unioned where started_at < $2 and ended_at > $1 and environment=$3
              and traffic_class=any($4::text[]) group by account_subject order by listening_seconds desc limit 500`, params),
        pool.query(`select * from (values
            (1,'Home visitors',(select count(distinct visitor_id)::bigint from ingest.raw_events where ${scope} and surface='home')),
            (2,'Account visitors',(select count(distinct visitor_id)::bigint from ingest.raw_events where ${scope} and surface='account')),
            (3,'Accounts created',(select count(distinct account_subject)::bigint from mart.account_facts where created_at >= $1 and created_at < $2 and environment=$3 and traffic_class=any($4::text[]))),
            (4,'Listeners',(select count(distinct account_subject)::bigint from mart.listening_intervals_unioned where started_at < $2 and ended_at > $1 and environment=$3 and traffic_class=any($4::text[]))),
            (5,'Event attendees',(select count(distinct person_subject)::bigint from mart.live_presence_intervals_unioned where started_at < $2 and ended_at > $1 and environment=$3 and traffic_class=any($4::text[]) and not is_staff and not is_test)),
            (6,'Current memberships',(select count(distinct account_subject)::bigint from mart.current_memberships where environment=$3 and traffic_class=any($4::text[]))),
            (7,'Confirmed payers',(select count(distinct account_subject)::bigint from mart.payment_facts where ${scope} and state='confirmed'))
          ) as funnel(stage,stage_name,people) order by stage`, params),
        pool.query(`select currency,
            count(*) filter(where paid_through >= $2 and state not in ('EXPIRED','REFUNDED','REVOKED'))::bigint subscribers,
            coalesce(sum(amount_minor) filter(where paid_through >= $2 and state not in ('EXPIRED','REFUNDED','REVOKED')),0)::bigint mrr_minor,
            count(*) filter(where terminal_at >= $1 and terminal_at < $2 and state in ('CANCELLED','EXPIRED','REFUNDED','REVOKED'))::bigint churned,
            count(*) filter(where effective_at >= $1 and effective_at < $2)::bigint starts
            from mart.current_memberships where environment=$3 and traffic_class=any($4::text[])
            group by currency order by currency`, params),
    ]);
    return {
        generated_at: new Date().toISOString(),
        filters: { ...filters, start: filters.start.toISOString(), end: filters.end.toISOString() },
        definitions: metricDefinitions,
        summary: { ...web.rows[0], ...accounts.rows[0], ...listen.rows[0], ...live.rows[0] },
        commerce: commerce.rows, acquisition: acquisition.rows, geography: geography.rows,
        devices: devices.rows, pages: pages.rows, events: events.rows, memberships: memberships.rows,
        listener_activity: listenerActivity.rows, funnel: funnel.rows, lifecycle: lifecycle.rows,
        campaigns: campaigns.rows, health: health.rows, series: series.rows, cohorts: cohorts.rows,
    };
}
