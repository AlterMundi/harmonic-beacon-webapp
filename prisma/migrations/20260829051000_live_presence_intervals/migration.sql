CREATE TABLE "live_presence_intervals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scheduled_session_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_heartbeat_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "end_reason" VARCHAR(32),
    "reconnect_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "live_presence_intervals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "live_presence_intervals_generation_check" CHECK ("generation" > 0),
    CONSTRAINT "live_presence_intervals_order_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
    CONSTRAINT "live_presence_intervals_scheduled_session_id_fkey" FOREIGN KEY ("scheduled_session_id") REFERENCES "scheduled_sessions"("id") ON DELETE CASCADE,
    CONSTRAINT "live_presence_intervals_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "session_participants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "live_presence_intervals_participant_id_generation_key"
    ON "live_presence_intervals"("participant_id", "generation");
CREATE UNIQUE INDEX "live_presence_intervals_one_open_per_participant"
    ON "live_presence_intervals"("participant_id") WHERE "ended_at" IS NULL;
CREATE INDEX "live_presence_intervals_scheduled_session_id_started_at_ended_at_idx"
    ON "live_presence_intervals"("scheduled_session_id", "started_at", "ended_at");
CREATE INDEX "live_presence_intervals_ended_at_last_heartbeat_at_idx"
    ON "live_presence_intervals"("ended_at", "last_heartbeat_at");

COMMENT ON TABLE "live_presence_intervals" IS
    'Authenticated server-observed Live attendance; open rows are capped by last heartbeat plus grace.';
