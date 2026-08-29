CREATE OR REPLACE VIEW mart.current_memberships AS
SELECT DISTINCT ON (account_subject) *
FROM mart.membership_snapshots
ORDER BY account_subject, effective_at DESC, ingested_at DESC,
         CASE WHEN source_system='authority' THEN 0 ELSE 1 END, revision DESC;
