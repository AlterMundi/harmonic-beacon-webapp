CREATE TYPE "CommerceProvider" AS ENUM ('TICKET_TAILOR');
CREATE TYPE "CommerceProviderState" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "CommerceAdministrativeState" AS ENUM ('CLEAR', 'SUSPENDED');
CREATE TYPE "CommerceMediaStatus" AS ENUM ('NOT_REQUIRED', 'RECONCILIATION_REQUIRED', 'DISCONNECTED');
CREATE TYPE "CommerceOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED');

CREATE TABLE "commerce_entitlements" (
    "id" UUID NOT NULL,
    "provider" "CommerceProvider" NOT NULL,
    "external_ticket_id" TEXT NOT NULL,
    "external_order_id" TEXT NOT NULL,
    "registration_id" UUID NOT NULL,
    "scheduled_session_id" UUID NOT NULL,
    "ticket_entitlement_id" UUID NOT NULL,
    "provider_state" "CommerceProviderState" NOT NULL,
    "administrative_state" "CommerceAdministrativeState" NOT NULL DEFAULT 'CLEAR',
    "reason_code" TEXT NOT NULL,
    "provision_revision" INTEGER NOT NULL,
    "command_hash" CHAR(64) NOT NULL,
    "bound_email" TEXT NOT NULL,
    "tier" "TicketTier" NOT NULL,
    "binding_grant_id" UUID,
    "highest_grant_generation" INTEGER,
    "binding_derivation_key_version" INTEGER,
    "binding_code_digest" CHAR(64),
    "grant_id" UUID,
    "grant_generation" INTEGER,
    "derivation_key_version" INTEGER,
    "code_digest_version" INTEGER,
    "provider_observed_at" TIMESTAMP(3) NOT NULL,
    "media_status" "CommerceMediaStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "livekit_identity_version" INTEGER NOT NULL DEFAULT 1,
    "max_livekit_token_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_entitlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "commerce_entitlements_binding_check" CHECK (
        ("provider_state" = 'ACTIVE' AND "grant_id" IS NOT NULL AND "grant_generation" IS NOT NULL
            AND "derivation_key_version" IS NOT NULL AND "code_digest_version" IS NOT NULL)
        OR
        ("provider_state" = 'REVOKED' AND "grant_id" IS NULL AND "grant_generation" IS NULL
            AND "derivation_key_version" IS NULL AND "code_digest_version" IS NULL)
    ),
    CONSTRAINT "commerce_entitlements_revision_check" CHECK ("provision_revision" >= 1),
    CONSTRAINT "commerce_entitlements_generation_check" CHECK ("grant_generation" IS NULL OR "grant_generation" >= 1),
    CONSTRAINT "commerce_entitlements_highest_generation_check" CHECK ("highest_grant_generation" IS NULL OR "highest_grant_generation" >= 1),
    CONSTRAINT "commerce_entitlements_livekit_identity_version_check" CHECK ("livekit_identity_version" >= 1),
    CONSTRAINT "commerce_entitlements_derivation_key_check" CHECK ("derivation_key_version" IS NULL OR "derivation_key_version" >= 1),
    CONSTRAINT "commerce_entitlements_digest_version_check" CHECK ("code_digest_version" IS NULL OR "code_digest_version" >= 1),
    CONSTRAINT "commerce_entitlements_historical_binding_check" CHECK (
        ("binding_grant_id" IS NULL AND "highest_grant_generation" IS NULL
            AND "binding_derivation_key_version" IS NULL AND "binding_code_digest" IS NULL)
        OR
        ("binding_grant_id" IS NOT NULL AND "highest_grant_generation" IS NOT NULL
            AND "binding_derivation_key_version" IS NOT NULL AND "binding_code_digest" IS NOT NULL)
    )
);

CREATE TABLE "commerce_entitlement_commands" (
    "id" UUID NOT NULL,
    "commerce_entitlement_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "provision_revision" INTEGER NOT NULL,
    "command_hash" CHAR(64) NOT NULL,
    "applied_snapshot" JSONB NOT NULL,
    "web_sessions_revoked" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_entitlement_commands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce_request_receipts" (
    "id" UUID NOT NULL,
    "commerce_entitlement_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "provision_revision" INTEGER NOT NULL,
    "command_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_request_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce_media_outbox" (
    "id" UUID NOT NULL,
    "commerce_entitlement_id" UUID NOT NULL,
    "provision_revision" INTEGER NOT NULL,
    "stage_room_name" TEXT NOT NULL,
    "participant_identity" TEXT NOT NULL,
    "bed_identity" TEXT NOT NULL,
    "token_horizon_at" TIMESTAMP(3) NOT NULL,
    "status" "CommerceOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "stage_removed" INTEGER NOT NULL DEFAULT 0,
    "bed_removed" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempt_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_media_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "commerce_media_outbox_revision_check" CHECK ("provision_revision" >= 1),
    CONSTRAINT "commerce_media_outbox_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "commerce_media_outbox_counts_check" CHECK ("stage_removed" >= 0 AND "bed_removed" >= 0)
);

CREATE UNIQUE INDEX "commerce_entitlements_provider_external_ticket_id_key"
    ON "commerce_entitlements"("provider", "external_ticket_id");
CREATE UNIQUE INDEX "commerce_entitlements_ticket_entitlement_id_key"
    ON "commerce_entitlements"("ticket_entitlement_id");
CREATE INDEX "commerce_entitlements_scheduled_session_id_provider_state_a_idx"
    ON "commerce_entitlements"("scheduled_session_id", "provider_state", "administrative_state");
CREATE INDEX "commerce_entitlements_grant_id_grant_generation_idx"
    ON "commerce_entitlements"("grant_id", "grant_generation");

CREATE UNIQUE INDEX "commerce_entitlement_commands_source_request_id_key"
    ON "commerce_entitlement_commands"("source", "request_id");
CREATE UNIQUE INDEX "commerce_entitlement_commands_commerce_entitlement_id_provi_key"
    ON "commerce_entitlement_commands"("commerce_entitlement_id", "provision_revision");
CREATE UNIQUE INDEX "commerce_request_receipts_source_request_id_key"
    ON "commerce_request_receipts"("source", "request_id");
CREATE INDEX "commerce_request_receipts_commerce_entitlement_id_provision_idx"
    ON "commerce_request_receipts"("commerce_entitlement_id", "provision_revision");

CREATE UNIQUE INDEX "commerce_media_outbox_commerce_entitlement_id_provision_rev_key"
    ON "commerce_media_outbox"("commerce_entitlement_id", "provision_revision");
CREATE INDEX "commerce_media_outbox_status_next_attempt_at_idx"
    ON "commerce_media_outbox"("status", "next_attempt_at");

ALTER TABLE "commerce_entitlements"
    ADD CONSTRAINT "commerce_entitlements_scheduled_session_id_fkey"
    FOREIGN KEY ("scheduled_session_id") REFERENCES "scheduled_sessions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commerce_entitlements"
    ADD CONSTRAINT "commerce_entitlements_ticket_entitlement_id_fkey"
    FOREIGN KEY ("ticket_entitlement_id") REFERENCES "ticket_entitlements"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commerce_entitlement_commands"
    ADD CONSTRAINT "commerce_entitlement_commands_commerce_entitlement_id_fkey"
    FOREIGN KEY ("commerce_entitlement_id") REFERENCES "commerce_entitlements"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commerce_request_receipts"
    ADD CONSTRAINT "commerce_request_receipts_commerce_entitlement_id_fkey"
    FOREIGN KEY ("commerce_entitlement_id") REFERENCES "commerce_entitlements"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commerce_media_outbox"
    ADD CONSTRAINT "commerce_media_outbox_commerce_entitlement_id_fkey"
    FOREIGN KEY ("commerce_entitlement_id") REFERENCES "commerce_entitlements"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
