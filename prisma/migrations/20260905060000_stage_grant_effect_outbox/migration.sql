CREATE TYPE "StageGrantEffectStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED');

CREATE TABLE "stage_grant_effect_outbox" (
    "id" UUID NOT NULL,
    "scheduled_session_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "grant_version" INTEGER NOT NULL,
    "room_name" TEXT NOT NULL,
    "participant_identity" TEXT NOT NULL,
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

ALTER TABLE "stage_grant_effect_outbox"
ADD CONSTRAINT "stage_grant_effect_outbox_participant_id_fkey"
FOREIGN KEY ("participant_id") REFERENCES "session_participants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve any reconciliation debt that predates the durable outbox. These
-- jobs use the participant's existing revision and current desired state;
-- every post-migration writer advances the revision before appending a job.
INSERT INTO "stage_grant_effect_outbox" (
    "id",
    "scheduled_session_id",
    "participant_id",
    "grant_version",
    "room_name",
    "participant_identity",
    "can_publish",
    "next_attempt_at",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    participant."scheduled_session_id",
    participant."id",
    participant."grant_version",
    session."room_name",
    participant."participant_identity",
    participant."publish_granted_at" IS NOT NULL AND participant."publish_revoked_at" IS NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "session_participants" participant
JOIN "scheduled_sessions" session ON session."id" = participant."scheduled_session_id"
WHERE participant."grant_reconcile_needed" = true
ON CONFLICT ("participant_id", "grant_version") DO NOTHING;
