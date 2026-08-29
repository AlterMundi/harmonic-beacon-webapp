export const RECLASSIFY_BROWSER_TRAFFIC_SQL = `with classified as (
      select e.event_id,(
        select a.traffic_class from identity_map.account_links a
        where a.visitor_id=e.visitor_id and e.occurred_at>=a.valid_from
          and (a.valid_to is null or e.occurred_at<a.valid_to)
        order by a.valid_from desc limit 1
      ) as traffic_class
      from ingest.raw_events e
      where e.source='browser' and e.traffic_class in ('real','unknown')
    )
    update ingest.raw_events e set traffic_class=c.traffic_class
    from classified c where e.event_id=c.event_id and c.traffic_class is not null
      and e.traffic_class<>c.traffic_class`;
