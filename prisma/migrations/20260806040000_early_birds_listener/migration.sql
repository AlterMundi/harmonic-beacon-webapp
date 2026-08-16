-- EarlyBirds is additive and deliberately isolated from weekend identities,
-- sessions, tickets, LiveKit participants, and contributions.
CREATE TYPE "EarlyBirdMembershipState" AS ENUM (
    'PENDING',
    'ACTIVE',
    'GRACE',
    'CANCELLED_PENDING_END',
    'EXPIRED',
    'REFUNDED',
    'REVOKED'
);

CREATE TYPE "EarlyBirdMembershipSource" AS ENUM (
    'FREE',
    'PAYPAL',
    'MERCADO_PAGO'
);

CREATE TABLE "early_bird_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "early_bird_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "early_bird_identities" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "early_bird_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "early_bird_auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "early_bird_auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "early_bird_verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "early_bird_verifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "early_bird_membership_projections" (
    "id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "command_hash" CHAR(64) NOT NULL,
    "state" "EarlyBirdMembershipState" NOT NULL,
    "source" "EarlyBirdMembershipSource",
    "offer_code" TEXT,
    "offer_revision" INTEGER,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "paid_through" TIMESTAMP(3),
    "grace_until" TIMESTAMP(3),
    "provider" TEXT,
    "amount_minor" INTEGER,
    "currency" VARCHAR(3),
    "reason_code" VARCHAR(64) NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "early_bird_membership_projections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "early_bird_stream_leases" (
    "id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "device_digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "evicted_at" TIMESTAMP(3),
    CONSTRAINT "early_bird_stream_leases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "early_bird_users_email_key" ON "early_bird_users"("email");
CREATE UNIQUE INDEX "early_bird_identities_provider_id_account_id_key" ON "early_bird_identities"("provider_id", "account_id");
CREATE INDEX "early_bird_identities_user_id_idx" ON "early_bird_identities"("user_id");
CREATE UNIQUE INDEX "early_bird_auth_sessions_token_key" ON "early_bird_auth_sessions"("token");
CREATE INDEX "early_bird_auth_sessions_user_id_idx" ON "early_bird_auth_sessions"("user_id");
CREATE INDEX "early_bird_auth_sessions_expires_at_idx" ON "early_bird_auth_sessions"("expires_at");
CREATE INDEX "early_bird_verifications_identifier_idx" ON "early_bird_verifications"("identifier");
CREATE INDEX "early_bird_verifications_expires_at_idx" ON "early_bird_verifications"("expires_at");
CREATE UNIQUE INDEX "early_bird_membership_projections_account_id_key" ON "early_bird_membership_projections"("account_id");
CREATE INDEX "early_bird_membership_projections_state_paid_through_idx" ON "early_bird_membership_projections"("state", "paid_through");
CREATE UNIQUE INDEX "early_bird_stream_leases_account_id_device_digest_key" ON "early_bird_stream_leases"("account_id", "device_digest");
CREATE INDEX "early_bird_stream_leases_account_id_evicted_at_expires_at_last_seen_at_idx" ON "early_bird_stream_leases"("account_id", "evicted_at", "expires_at", "last_seen_at");

ALTER TABLE "early_bird_identities"
    ADD CONSTRAINT "early_bird_identities_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "early_bird_auth_sessions"
    ADD CONSTRAINT "early_bird_auth_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "early_bird_membership_projections"
    ADD CONSTRAINT "early_bird_membership_projections_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "early_bird_stream_leases"
    ADD CONSTRAINT "early_bird_stream_leases_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
