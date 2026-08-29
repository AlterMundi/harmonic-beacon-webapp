CREATE OR REPLACE VIEW mart.commerce_summary AS
SELECT occurred_at::date AS metric_date, environment, traffic_class, currency,
       count(*) FILTER (WHERE state='confirmed') AS confirmed_payments,
       count(*) FILTER (WHERE state='refunded') AS refunds,
       coalesce(sum(CASE WHEN state='confirmed' THEN amount_minor
                         WHEN state IN ('refunded','reversed') THEN -amount_minor ELSE 0 END),0) AS net_revenue_minor,
       count(*) FILTER (WHERE state='reversed') AS reversals
FROM mart.payment_facts
GROUP BY 1,2,3,4;
