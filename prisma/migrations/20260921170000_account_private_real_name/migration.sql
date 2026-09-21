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

-- Scope expansion is a separate subsequent migration, after this image has
-- become the proven rollback target. The current production image requires
-- exactly openid/profile scopes in readiness; preserve that recovery boundary.
