import pg from 'pg';

const { Pool } = pg;

export function createStore(connectionString = process.env.ANALYTICS_DATABASE_URL) {
    if (!connectionString) throw new Error('ANALYTICS_DATABASE_URL is required');
    const pool = new Pool({ connectionString, max: Number(process.env.ANALYTICS_COLLECTOR_POOL_MAX ?? 5), application_name: 'hb-analytics-collector' });
    return {
        pool,
        async ready() {
            const result = await pool.query('select 1 as ready');
            return result.rows[0]?.ready === 1;
        },
        async insert(event, request) {
            const result = await pool.query({
                text: `insert into ingest.raw_events (
                    event_id, schema_version, event_name, occurred_at, source, surface, environment,
                    visitor_id, session_id, account_subject, page, attribution, first_attribution,
                    last_attribution, device, traffic_class,
                    properties, country_code, region_code, network_digest, received_at
                ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18,$19,$20,now())
                on conflict (event_id) do nothing returning event_id`,
                values: [
                    event.event_id, event.schema_version, event.event_name, event.occurred_at,
                    event.source, event.surface, event.environment, event.visitor_id, event.session_id,
                    event.account_subject, JSON.stringify(event.page), JSON.stringify(event.attribution),
                    JSON.stringify(event.first_attribution), JSON.stringify(event.last_attribution),
                    JSON.stringify(event.device), event.traffic_class, JSON.stringify(event.properties),
                    request.countryCode, request.regionCode, request.networkDigest,
                ],
            });
            return result.rowCount === 1;
        },
        close: () => pool.end(),
    };
}
