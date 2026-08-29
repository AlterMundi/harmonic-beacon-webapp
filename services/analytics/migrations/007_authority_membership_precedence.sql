-- The commerce Authority wins whenever both it and Listener project the same
-- account. Recency only orders rows inside the same authority tier.
CREATE OR REPLACE VIEW mart.current_memberships AS
SELECT DISTINCT ON (account_subject) *
FROM mart.membership_snapshots
ORDER BY account_subject,
         CASE WHEN source_system='authority' THEN 0 ELSE 1 END,
         effective_at DESC,
         ingested_at DESC,
         revision DESC;
