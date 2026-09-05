CREATE TYPE "StageGrantEffectStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'SUPERSEDED');

CREATE TABLE "stage_grant_effect_outbox" (
    "id" UUID NOT NULL,
    "scheduled_session_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "grant_version" INTEGER NOT NULL,
    "room_name" TEXT NOT NULL,
    "participant_identity" TEXT NOT NULL,
    "resulting_participant_identity" TEXT NOT NULL,
    "can_publish" BOOLEAN NOT NULL,
    "disconnect_participant" BOOLEAN NOT NULL DEFAULT false,
    "bed_room_name" TEXT,
    "bed_identity" TEXT,
    "token_horizon_at" TIMESTAMP(3),
    "status" "StageGrantEffectStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claim_token" UUID,
    "claimed_at" TIMESTAMP(3),
    "lease_expires_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error_code" TEXT,
    "grant_applied_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stage_grant_effect_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stage_grant_effect_outbox_participant_id_grant_version_key"
ON "stage_grant_effect_outbox"("participant_id", "grant_version");

CREATE INDEX "stage_grant_effect_outbox_status_next_attempt_at_idx"
ON "stage_grant_effect_outbox"("status", "next_attempt_at");

CREATE INDEX "stage_grant_effect_outbox_participant_id_status_grant_version_idx"
ON "stage_grant_effect_outbox"("participant_id", "status", "grant_version");

ALTER TABLE "stage_grant_effect_outbox"
ADD CONSTRAINT "stage_grant_effect_outbox_scheduled_session_id_fkey"
FOREIGN KEY ("scheduled_session_id") REFERENCES "scheduled_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Every returned room token extends the horizon through which a previous
-- identity must be fenced after a demotion or credential rotation. Both active
-- and already-revoked publishers may still hold a legacy four-hour publisher
-- JWT, so the additive rollout starts conservatively for every participant who
-- has ever held the grant.
ALTER TABLE "session_participants"
ADD COLUMN "max_livekit_token_expires_at" TIMESTAMP(3);

UPDATE "session_participants"
SET "max_livekit_token_expires_at" = CURRENT_TIMESTAMP + INTERVAL '4 hours',
    "grant_reconcile_needed" = true
WHERE "publish_granted_at" IS NOT NULL;

ALTER TABLE "stage_grant_effect_outbox"
ADD CONSTRAINT "stage_grant_effect_outbox_participant_id_fkey"
FOREIGN KEY ("participant_id") REFERENCES "session_participants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Legacy reconciliation debt is deliberately not copied into an unversioned
-- same-identity effect here. The compatible worker rotates every marked legacy
-- publisher identity before claiming work: one negative transition for an
-- already-revoked publisher, or a negative/positive pair that preserves an
-- active durable grant under a fresh identity.
