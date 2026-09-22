-- NULL means not yet observed from authenticated Account UserInfo.
-- Do not revoke old sessions or infer profile/email from tickets and aliases.
ALTER TABLE "web_sessions"
  ADD COLUMN "account_email" VARCHAR(320),
  ADD COLUMN "account_email_verified" BOOLEAN,
  ADD COLUMN "account_profile_complete" BOOLEAN;
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_account_email_verification"
  CHECK ("account_email_verified" IS NULL OR "account_email" IS NOT NULL);

ALTER TABLE "ticket_entitlements"
  ADD COLUMN "account_email" VARCHAR(320),
  ADD COLUMN "account_email_verified" BOOLEAN;
ALTER TABLE "ticket_entitlements" ADD CONSTRAINT "ticket_account_email_snapshot"
  CHECK ("account_email" IS NULL OR ("account_issuer" IS NOT NULL AND "account_id" IS NOT NULL));
ALTER TABLE "ticket_entitlements" ADD CONSTRAINT "ticket_account_email_verification"
  CHECK ("account_email_verified" IS NULL OR "account_email" IS NOT NULL);
