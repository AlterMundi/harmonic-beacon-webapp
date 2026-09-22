BEGIN;

-- Phase one (3bca8a0fd9261e25c6001686c5f65bd153cf4f3a) is the
-- application-only rollback target and accepts both exact scope inventories.
-- Replace the constraint and data in one transaction so enabled clients can
-- never commit in an intermediate, constraint-free state.
ALTER TABLE "beacon_oauth_clients"
  DROP CONSTRAINT "beacon_oauth_clients_static_confidential_check";

UPDATE "beacon_oauth_clients"
SET "scopes" = ARRAY['openid', 'profile', 'email']::TEXT[]
WHERE "disabled" = false
  AND "scopes" = ARRAY['openid', 'profile']::TEXT[];

ALTER TABLE "beacon_oauth_clients"
  ADD CONSTRAINT "beacon_oauth_clients_static_confidential_check" CHECK (
    "disabled" = true OR (
      "public" = false
      AND "require_pkce" = true
      AND "skip_consent" = true
      AND "enable_end_session" = true
      AND "subject_type" = 'public'
      AND "type" = 'web'
      AND "grant_types" = ARRAY['authorization_code']::TEXT[]
      AND "response_types" = ARRAY['code']::TEXT[]
      AND "scopes" = ARRAY['openid', 'profile', 'email']::TEXT[]
    )
  );

COMMIT;
