-- Fresh schema for the 2026-08-01/02 weekend MVP.
-- This migration intentionally contains no legacy-data or compatibility path.

CREATE TYPE "StaffRole" AS ENUM ('FACILITATOR', 'OPERATOR', 'ADMIN');
CREATE TYPE "SessionLanguage" AS ENUM ('ENGLISH', 'SPANISH');
CREATE TYPE "ScheduledSessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');
CREATE TYPE "TicketTier" AS ENUM ('GLOBAL_NORTH', 'GLOBAL_SOUTH', 'COMP', 'SUPPORT_OVERRIDE');
CREATE TYPE "TicketEntitlementState" AS ENUM ('ISSUED', 'BOUND', 'REVOKED', 'EXPIRED');

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "password_digest" TEXT NOT NULL,
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_normalized_check" CHECK ("email" = lower(btrim("email")))
);

CREATE TABLE "scheduled_sessions" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "room_name" TEXT NOT NULL,
    "language" "SessionLanguage" NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "status" "ScheduledSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "paid_mode" BOOLEAN NOT NULL DEFAULT true,
    "attendee_cap" INTEGER NOT NULL DEFAULT 150,
    "max_publishers" INTEGER NOT NULL DEFAULT 6,
    "facilitator_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scheduled_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scheduled_sessions_weekend_paid_mode_check" CHECK ("paid_mode" = true),
    CONSTRAINT "scheduled_sessions_weekend_attendee_cap_check" CHECK ("attendee_cap" = 150),
    CONSTRAINT "scheduled_sessions_weekend_max_publishers_check" CHECK ("max_publishers" = 6)
);

CREATE TABLE "ticket_entitlements" (
    "id" UUID NOT NULL,
    "scheduled_session_id" UUID NOT NULL,
    "code_digest" TEXT NOT NULL,
    "code_last_four" VARCHAR(4) NOT NULL,
    "tier" "TicketTier" NOT NULL,
    "state" "TicketEntitlementState" NOT NULL DEFAULT 'ISSUED',
    "bound_email" TEXT,
    "bound_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "issued_by_user_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" UUID,
    "revocation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ticket_entitlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ticket_entitlements_last_four_check" CHECK (char_length("code_last_four") = 4),
    CONSTRAINT "ticket_entitlements_bound_email_normalized_check" CHECK (
        "bound_email" IS NULL OR "bound_email" = lower(btrim("bound_email"))
    ),
    CONSTRAINT "ticket_entitlements_binding_check" CHECK (
        ("state" = 'BOUND' AND "bound_email" IS NOT NULL AND "bound_at" IS NOT NULL)
        OR ("state" <> 'BOUND')
    ),
    CONSTRAINT "ticket_entitlements_revocation_check" CHECK (
        ("state" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)
        OR ("state" <> 'REVOKED')
    )
);

CREATE TABLE "web_sessions" (
    "id" UUID NOT NULL,
    "token_digest" TEXT NOT NULL,
    "staff_user_id" UUID,
    "ticket_entitlement_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" UUID,
    "revocation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "web_sessions_one_principal_check" CHECK (
        ("staff_user_id" IS NOT NULL)::integer +
        ("ticket_entitlement_id" IS NOT NULL)::integer = 1
    ),
    CONSTRAINT "web_sessions_revocation_check" CHECK (
        ("revoked_at" IS NULL AND "revocation_reason" IS NULL)
        OR ("revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)
    )
);

CREATE TABLE "session_participants" (
    "id" UUID NOT NULL,
    "scheduled_session_id" UUID NOT NULL,
    "participant_identity" TEXT NOT NULL,
    "ticket_entitlement_id" UUID,
    "staff_user_id" UUID,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "raised_at" TIMESTAMP(3),
    "publish_granted_at" TIMESTAMP(3),
    "publish_revoked_at" TIMESTAMP(3),
    "grant_version" INTEGER NOT NULL DEFAULT 0,
    "grant_reconcile_needed" BOOLEAN NOT NULL DEFAULT false,
    "grant_changed_by_user_id" UUID,
    "grant_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "session_participants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "session_participants_one_principal_check" CHECK (
        ("staff_user_id" IS NOT NULL)::integer +
        ("ticket_entitlement_id" IS NOT NULL)::integer = 1
    ),
    CONSTRAINT "session_participants_grant_version_check" CHECK ("grant_version" >= 0)
);

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "scheduled_sessions_room_name_key" ON "scheduled_sessions"("room_name");
CREATE INDEX "scheduled_sessions_status_scheduled_at_idx" ON "scheduled_sessions"("status", "scheduled_at");
CREATE UNIQUE INDEX "ticket_entitlements_code_digest_key" ON "ticket_entitlements"("code_digest");
CREATE INDEX "ticket_entitlements_scheduled_session_id_state_idx" ON "ticket_entitlements"("scheduled_session_id", "state");
CREATE INDEX "ticket_entitlements_bound_email_idx" ON "ticket_entitlements"("bound_email");
CREATE INDEX "ticket_entitlements_code_last_four_idx" ON "ticket_entitlements"("code_last_four");
CREATE UNIQUE INDEX "web_sessions_token_digest_key" ON "web_sessions"("token_digest");
CREATE INDEX "web_sessions_staff_user_id_idx" ON "web_sessions"("staff_user_id");
CREATE INDEX "web_sessions_ticket_entitlement_id_idx" ON "web_sessions"("ticket_entitlement_id");
CREATE INDEX "web_sessions_expires_at_idx" ON "web_sessions"("expires_at");
CREATE UNIQUE INDEX "session_participants_scheduled_session_id_participant_identity_key"
    ON "session_participants"("scheduled_session_id", "participant_identity");
CREATE UNIQUE INDEX "session_participants_scheduled_session_id_ticket_entitlement_id_key"
    ON "session_participants"("scheduled_session_id", "ticket_entitlement_id")
    WHERE "ticket_entitlement_id" IS NOT NULL;
CREATE UNIQUE INDEX "session_participants_scheduled_session_id_staff_user_id_key"
    ON "session_participants"("scheduled_session_id", "staff_user_id")
    WHERE "staff_user_id" IS NOT NULL;
CREATE INDEX "session_participants_scheduled_session_id_raised_at_idx"
    ON "session_participants"("scheduled_session_id", "raised_at");
CREATE INDEX "session_participants_scheduled_session_id_publish_granted_at_idx"
    ON "session_participants"("scheduled_session_id", "publish_granted_at");
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

ALTER TABLE "scheduled_sessions"
    ADD CONSTRAINT "scheduled_sessions_facilitator_id_fkey"
    FOREIGN KEY ("facilitator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_entitlements"
    ADD CONSTRAINT "ticket_entitlements_scheduled_session_id_fkey"
    FOREIGN KEY ("scheduled_session_id") REFERENCES "scheduled_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_entitlements"
    ADD CONSTRAINT "ticket_entitlements_issued_by_user_id_fkey"
    FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_entitlements"
    ADD CONSTRAINT "ticket_entitlements_revoked_by_user_id_fkey"
    FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "web_sessions"
    ADD CONSTRAINT "web_sessions_staff_user_id_fkey"
    FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_sessions"
    ADD CONSTRAINT "web_sessions_ticket_entitlement_id_fkey"
    FOREIGN KEY ("ticket_entitlement_id") REFERENCES "ticket_entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_sessions"
    ADD CONSTRAINT "web_sessions_revoked_by_user_id_fkey"
    FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "session_participants"
    ADD CONSTRAINT "session_participants_scheduled_session_id_fkey"
    FOREIGN KEY ("scheduled_session_id") REFERENCES "scheduled_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_participants"
    ADD CONSTRAINT "session_participants_ticket_entitlement_id_fkey"
    FOREIGN KEY ("ticket_entitlement_id") REFERENCES "ticket_entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_participants"
    ADD CONSTRAINT "session_participants_staff_user_id_fkey"
    FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_participants"
    ADD CONSTRAINT "session_participants_grant_changed_by_user_id_fkey"
    FOREIGN KEY ("grant_changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
