-- Existing profiles remain incomplete until their owner declares this value.
-- Never derive private names from public aliases or provider metadata.
ALTER TABLE "beacon_profiles" ADD COLUMN "real_name" VARCHAR(120);
ALTER TABLE "beacon_profiles" ADD CONSTRAINT "beacon_profiles_real_name_nonempty"
  CHECK ("real_name" IS NULL OR length(btrim("real_name")) > 0);

-- Email signup supplies both names in one nested Prisma create. Deferring the
-- fallback lets that nested profile win, while provider-created accounts still
-- receive an incomplete profile (real_name NULL) at commit.
DROP TRIGGER "beacon_profile_after_account_insert_trigger" ON "early_bird_users";
CREATE CONSTRAINT TRIGGER "beacon_profile_after_account_insert_trigger"
AFTER INSERT ON "early_bird_users"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "beacon_profile_after_account_insert"();

-- Standard email claims are opt-in and never include the private real name.
ALTER TABLE "beacon_oauth_clients"
  DROP CONSTRAINT "beacon_oauth_clients_static_confidential_check";
UPDATE "beacon_oauth_clients"
SET "scopes" = ARRAY['openid', 'profile', 'email']::TEXT[]
WHERE "scopes" = ARRAY['openid', 'profile']::TEXT[];
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
