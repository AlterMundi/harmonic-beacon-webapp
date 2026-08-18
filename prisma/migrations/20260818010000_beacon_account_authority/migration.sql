-- Central Account authority is forward-only. Existing opaque account IDs and
-- every Listener foreign key remain unchanged.
ALTER TABLE "early_bird_users"
    ADD COLUMN "security_revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "early_bird_auth_sessions"
    ADD COLUMN "security_revision" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "authority_environment" TEXT NOT NULL DEFAULT 'legacy';

CREATE TABLE "beacon_account_authority_environment" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "beacon_account_authority_environment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "beacon_account_authority_environment_issuer_key"
    ON "beacon_account_authority_environment"("issuer");

CREATE TABLE "beacon_profiles" (
    "account_id" TEXT NOT NULL,
    "display_name" VARCHAR(60) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "beacon_profiles_pkey" PRIMARY KEY ("account_id"),
    CONSTRAINT "beacon_profiles_display_name_check" CHECK (
        char_length(btrim("display_name")) BETWEEN 1 AND 60
        AND "display_name" !~ '[[:cntrl:]]'
        AND "display_name" !~ U&'[\00AD\061C\180E\200B-\200F\202A-\202E\2060-\206F\FEFF]'
    ),
    CONSTRAINT "beacon_profiles_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "beacon_profiles_account_id_fkey" FOREIGN KEY ("account_id")
        REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Seed the private profile once. Provider profile changes never update it.
INSERT INTO "beacon_profiles" ("account_id", "display_name", "revision", "created_at", "updated_at")
SELECT
    "id",
    CASE
        WHEN char_length(btrim("name")) BETWEEN 1 AND 60
             AND btrim("name") !~ '[[:cntrl:]]'
             AND btrim("name") !~ U&'[\00AD\061C\180E\200B-\200F\202A-\202E\2060-\206F\FEFF]'
            THEN btrim("name")
        ELSE 'Beacon Listener'
    END,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "early_bird_users";

-- Every canonical account has a profile even if an auth hook/process crashes
-- after inserting the account. Application hooks remain idempotent helpers;
-- this database invariant is the authority.
CREATE FUNCTION "beacon_profile_after_account_insert"() RETURNS trigger AS $$
BEGIN
    INSERT INTO "beacon_profiles" (
        "account_id", "display_name", "revision", "created_at", "updated_at"
    ) VALUES (
        NEW."id",
        CASE
            WHEN char_length(btrim(NEW."name")) BETWEEN 1 AND 60
                 AND btrim(NEW."name") !~ '[[:cntrl:]]'
                 AND btrim(NEW."name") !~ U&'[\00AD\061C\180E\200B-\200F\202A-\202E\2060-\206F\FEFF]'
                THEN btrim(NEW."name")
            ELSE 'Beacon Listener'
        END,
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ) ON CONFLICT ("account_id") DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "beacon_profile_after_account_insert_trigger"
AFTER INSERT ON "early_bird_users"
FOR EACH ROW EXECUTE FUNCTION "beacon_profile_after_account_insert"();

-- This is a pre-public authority cutover, not a rolling session migration.
-- Provider/account rows and all product FKs survive, while every legacy
-- browser session and one-use artifact is invalidated atomically.
DELETE FROM "early_bird_auth_sessions";
DELETE FROM "early_bird_verifications";
DELETE FROM "early_bird_magic_link_throttles";

-- Accounts keep the access method with which they were first established.
-- Pre-public linking experiments are collapsed deterministically to the
-- earliest identity while retaining the opaque account row and product FKs.
DELETE FROM "early_bird_identities" candidate
USING "early_bird_identities" keeper
WHERE candidate."user_id" = keeper."user_id"
  AND (candidate."created_at", candidate."id") > (keeper."created_at", keeper."id");
DROP INDEX IF EXISTS "early_bird_identities_user_id_idx";
CREATE UNIQUE INDEX "early_bird_identities_user_id_key" ON "early_bird_identities"("user_id");

-- Provider bearer/refresh/ID tokens are never authority data. Erase any
-- pre-public residue and enforce the boundary below the ORM hooks.
UPDATE "early_bird_identities"
SET "access_token" = NULL,
    "refresh_token" = NULL,
    "id_token" = NULL,
    "access_token_expires_at" = NULL,
    "refresh_token_expires_at" = NULL,
    "scope" = NULL;
ALTER TABLE "early_bird_identities"
    ADD CONSTRAINT "early_bird_identities_no_provider_tokens_check" CHECK (
        "access_token" IS NULL
        AND "refresh_token" IS NULL
        AND "id_token" IS NULL
        AND "access_token_expires_at" IS NULL
        AND "refresh_token_expires_at" IS NULL
        AND "scope" IS NULL
    );

CREATE TABLE "beacon_account_action_tokens" (
    "id" UUID NOT NULL,
    "token_digest" CHAR(64) NOT NULL,
    "purpose" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "target_email" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "beacon_account_action_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "beacon_account_action_tokens_purpose_check" CHECK (
        "purpose" IN ('verify_email', 'reset_password', 'change_email')
    ),
    CONSTRAINT "beacon_account_action_tokens_locale_check" CHECK ("locale" IN ('es', 'en')),
    CONSTRAINT "beacon_account_action_tokens_account_id_fkey" FOREIGN KEY ("account_id")
        REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "beacon_account_action_tokens_token_digest_key" ON "beacon_account_action_tokens"("token_digest");
CREATE INDEX "beacon_account_action_tokens_account_id_purpose_expires_at_idx" ON "beacon_account_action_tokens"("account_id", "purpose", "expires_at");
CREATE INDEX "beacon_account_action_tokens_expires_at_idx" ON "beacon_account_action_tokens"("expires_at");
CREATE INDEX "beacon_account_action_tokens_consumed_at_idx" ON "beacon_account_action_tokens"("consumed_at");

CREATE TABLE "beacon_account_auth_throttles" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "beacon_account_auth_throttles_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "beacon_account_auth_throttles_updated_at_idx" ON "beacon_account_auth_throttles"("updated_at");

CREATE TABLE "beacon_account_mail_outbox" (
    "id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'verify_email',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "recipient" TEXT NOT NULL,
    "target_email" TEXT,
    "sealed_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "idempotency_key" TEXT,
    "delivery_attempted_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "beacon_account_mail_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "beacon_account_mail_outbox_account_id_fkey" FOREIGN KEY ("account_id")
        REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "beacon_account_mail_outbox_purpose_check" CHECK (
        "purpose" IN ('verify_email', 'reset_password', 'change_email')
    ),
    CONSTRAINT "beacon_account_mail_outbox_locale_check" CHECK ("locale" IN ('es', 'en'))
);
ALTER TABLE "beacon_account_mail_outbox"
    ADD CONSTRAINT "beacon_account_mail_outbox_generation_check" CHECK ("generation" >= 1),
    ADD CONSTRAINT "beacon_account_mail_outbox_idempotency_key_check" CHECK (
        "idempotency_key" IS NULL OR "idempotency_key" ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT "beacon_account_mail_outbox_payload_shape_check" CHECK (
        ("sealed_token" IS NULL AND "token_expires_at" IS NULL AND "idempotency_key" IS NULL)
        OR
        ("sealed_token" IS NOT NULL AND "token_expires_at" IS NOT NULL AND "idempotency_key" IS NOT NULL)
    );
CREATE UNIQUE INDEX "beacon_account_mail_outbox_account_id_purpose_generation_key"
    ON "beacon_account_mail_outbox"("account_id", "purpose", "generation");
CREATE INDEX "beacon_account_mail_outbox_next_attempt_at_locked_at_idx"
    ON "beacon_account_mail_outbox"("next_attempt_at", "locked_at");

-- Credential creation and verification delivery intent commit together in
-- the Better Auth adapter transaction. Network delivery is always post-commit.
CREATE FUNCTION "beacon_verification_outbox_after_identity_insert"() RETURNS trigger AS $$
BEGIN
    IF NEW."provider_id" = 'credential' THEN
        INSERT INTO "beacon_account_mail_outbox" (
            "id", "account_id", "purpose", "locale", "recipient", "attempts",
            "next_attempt_at", "created_at", "updated_at"
        ) VALUES (
            gen_random_uuid(), NEW."user_id", 'verify_email', 'en',
            (SELECT "email" FROM "early_bird_users" WHERE "id" = NEW."user_id"), 0,
            CURRENT_TIMESTAMP + INTERVAL '5 seconds', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "beacon_verification_outbox_after_identity_insert_trigger"
AFTER INSERT ON "early_bird_identities"
FOR EACH ROW EXECUTE FUNCTION "beacon_verification_outbox_after_identity_insert"();

INSERT INTO "beacon_account_mail_outbox" (
    "id", "account_id", "purpose", "locale", "recipient", "attempts",
    "next_attempt_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), identity."user_id", 'verify_email', 'en', account."email", 0,
       CURRENT_TIMESTAMP + INTERVAL '5 seconds', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "early_bird_identities" identity
JOIN "early_bird_users" account ON account."id" = identity."user_id"
WHERE identity."provider_id" = 'credential' AND account."email_verified" = false
ON CONFLICT ("account_id", "purpose", "generation") DO NOTHING;

CREATE TABLE "listener_account_subjects" (
    "account_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "listener_account_subjects_pkey" PRIMARY KEY ("account_id"),
    CONSTRAINT "listener_account_subjects_account_id_fkey" FOREIGN KEY ("account_id")
        REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "listener_account_subjects_issuer_subject_key"
    ON "listener_account_subjects"("issuer", "subject");

CREATE TABLE "listener_account_sessions" (
    "id" UUID NOT NULL,
    "token_digest" CHAR(64) NOT NULL,
    "account_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sid" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_checked_at" TIMESTAMP(3) NOT NULL,
    "revalidation_lease_until" TIMESTAMP(3),
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "listener_account_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "listener_account_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "listener_account_sessions_token_digest_key" ON "listener_account_sessions"("token_digest");
CREATE INDEX "listener_account_sessions_account_id_idx" ON "listener_account_sessions"("account_id");
CREATE INDEX "listener_account_sessions_issuer_subject_idx" ON "listener_account_sessions"("issuer", "subject");
CREATE INDEX "listener_account_sessions_issuer_sid_idx" ON "listener_account_sessions"("issuer", "sid");
CREATE INDEX "listener_account_sessions_expires_at_idx" ON "listener_account_sessions"("expires_at");
CREATE INDEX "listener_account_sessions_revalidation_lease_until_idx"
    ON "listener_account_sessions"("revalidation_lease_until");

CREATE TABLE "beacon_oauth_clients" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "skip_consent" BOOLEAN,
    "enable_end_session" BOOLEAN,
    "subject_type" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tos" TEXT,
    "policy" TEXT,
    "software_id" TEXT,
    "software_version" TEXT,
    "software_statement" TEXT,
    "redirect_uris" TEXT[] NOT NULL,
    "post_logout_redirect_uris" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "token_endpoint_auth_method" TEXT,
    "grant_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "response_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "public" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT,
    "require_pkce" BOOLEAN NOT NULL DEFAULT true,
    "reference_id" TEXT,
    "metadata" JSONB,
    CONSTRAINT "beacon_oauth_clients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "beacon_oauth_clients_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "early_bird_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "beacon_oauth_clients_auth_method_check" CHECK (
        "token_endpoint_auth_method" = 'client_secret_basic'
    ),
    CONSTRAINT "beacon_oauth_clients_static_confidential_check" CHECK (
        "disabled" = true OR (
        "public" = false
        AND "require_pkce" = true
        AND "skip_consent" = true
        AND "enable_end_session" = true
        AND "subject_type" = 'public'
        AND "type" = 'web'
        AND "grant_types" = ARRAY['authorization_code']::TEXT[]
        AND "response_types" = ARRAY['code']::TEXT[]
        AND "scopes" = ARRAY['openid', 'profile']::TEXT[]
        )
    )
);
CREATE UNIQUE INDEX "beacon_oauth_clients_client_id_key" ON "beacon_oauth_clients"("client_id");
CREATE INDEX "beacon_oauth_clients_user_id_idx" ON "beacon_oauth_clients"("user_id");

CREATE TABLE "beacon_oauth_refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT NOT NULL,
    "reference_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked" TIMESTAMP(3),
    "auth_time" TIMESTAMP(3),
    "scopes" TEXT[] NOT NULL,
    CONSTRAINT "beacon_oauth_refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "beacon_oauth_refresh_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "beacon_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "beacon_oauth_refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "early_bird_auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "beacon_oauth_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "beacon_oauth_refresh_tokens_token_key" ON "beacon_oauth_refresh_tokens"("token");
CREATE INDEX "beacon_oauth_refresh_tokens_client_id_idx" ON "beacon_oauth_refresh_tokens"("client_id");
CREATE INDEX "beacon_oauth_refresh_tokens_session_id_idx" ON "beacon_oauth_refresh_tokens"("session_id");
CREATE INDEX "beacon_oauth_refresh_tokens_user_id_idx" ON "beacon_oauth_refresh_tokens"("user_id");
CREATE INDEX "beacon_oauth_refresh_tokens_expires_at_idx" ON "beacon_oauth_refresh_tokens"("expires_at");
CREATE INDEX "beacon_oauth_refresh_tokens_revoked_idx" ON "beacon_oauth_refresh_tokens"("revoked");

CREATE TABLE "beacon_oauth_access_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT,
    "reference_id" TEXT,
    "refresh_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scopes" TEXT[] NOT NULL,
    CONSTRAINT "beacon_oauth_access_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "beacon_oauth_access_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "beacon_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "beacon_oauth_access_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "early_bird_auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "beacon_oauth_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "early_bird_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "beacon_oauth_access_tokens_refresh_id_fkey" FOREIGN KEY ("refresh_id") REFERENCES "beacon_oauth_refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "beacon_oauth_access_tokens_token_key" ON "beacon_oauth_access_tokens"("token");
CREATE INDEX "beacon_oauth_access_tokens_client_id_idx" ON "beacon_oauth_access_tokens"("client_id");
CREATE INDEX "beacon_oauth_access_tokens_session_id_idx" ON "beacon_oauth_access_tokens"("session_id");
CREATE INDEX "beacon_oauth_access_tokens_user_id_idx" ON "beacon_oauth_access_tokens"("user_id");
CREATE INDEX "beacon_oauth_access_tokens_refresh_id_idx" ON "beacon_oauth_access_tokens"("refresh_id");
CREATE INDEX "beacon_oauth_access_tokens_expires_at_idx" ON "beacon_oauth_access_tokens"("expires_at");

CREATE TABLE "beacon_oauth_consents" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT,
    "reference_id" TEXT,
    "scopes" TEXT[] NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "beacon_oauth_consents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "beacon_oauth_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "beacon_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "beacon_oauth_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "beacon_oauth_consents_client_id_idx" ON "beacon_oauth_consents"("client_id");
CREATE INDEX "beacon_oauth_consents_user_id_idx" ON "beacon_oauth_consents"("user_id");

CREATE TABLE "beacon_jwks" (
    "id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    CONSTRAINT "beacon_jwks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "beacon_jwks_expires_at_idx" ON "beacon_jwks"("expires_at");
