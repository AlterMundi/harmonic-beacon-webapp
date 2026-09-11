ALTER TABLE "beacon_oauth_clients"
    DROP CONSTRAINT "beacon_oauth_clients_static_confidential_check";

UPDATE "beacon_oauth_clients"
SET "scopes" = ARRAY['openid', 'profile', 'email']::TEXT[]
WHERE "disabled" = FALSE;

ALTER TABLE "beacon_oauth_clients"
    ADD CONSTRAINT "beacon_oauth_clients_static_confidential_check" CHECK (
        "disabled" = TRUE OR (
            "public" = FALSE
            AND "require_pkce" = TRUE
            AND "skip_consent" = TRUE
            AND "enable_end_session" = TRUE
            AND "subject_type" = 'public'
            AND "type" = 'web'
            AND "grant_types" = ARRAY['authorization_code']::TEXT[]
            AND "response_types" = ARRAY['code']::TEXT[]
            AND "scopes" = ARRAY['openid', 'profile', 'email']::TEXT[]
        )
    );
