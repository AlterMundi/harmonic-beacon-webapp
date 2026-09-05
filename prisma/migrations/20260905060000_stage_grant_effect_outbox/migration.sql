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
-- identity must be fenced after a demotion or credential rotation. Existing
-- grants may have been issued with the legacy four-hour staff TTL, so the
-- additive rollout starts conservatively.
ALTER TABLE "session_participants"
ADD COLUMN "max_livekit_token_expires_at" TIMESTAMP(3);

UPDATE "session_participants"
SET "max_livekit_token_expires_at" = CURRENT_TIMESTAMP + INTERVAL '4 hours'
WHERE "publish_granted_at" IS NOT NULL
  AND "publish_revoked_at" IS NULL;

ALTER TABLE "stage_grant_effect_outbox"
ADD CONSTRAINT "stage_grant_effect_outbox_participant_id_fkey"
FOREIGN KEY ("participant_id") REFERENCES "session_participants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Legacy reconciliation debt is deliberately not copied into an unversioned
-- same-identity effect here: doing that for a negative grant would preserve an
-- old editor JWT. The compatible worker detects every marked legacy debt and
-- appends a fresh revision, rotating the identity when the durable state is
-- non-publishing, before claiming work.
