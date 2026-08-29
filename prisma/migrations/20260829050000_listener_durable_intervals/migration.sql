CREATE TABLE "early_bird_listening_intervals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" TEXT NOT NULL,
    "lease_id" UUID NOT NULL,
    "lease_generation" INTEGER NOT NULL,
    "presence_sequence" INTEGER NOT NULL,
    "device_digest" CHAR(64) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_heartbeat_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "end_reason" VARCHAR(32),
    "access_class" VARCHAR(32) NOT NULL,
    "source_category" VARCHAR(16) NOT NULL DEFAULT 'beacon',
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "early_bird_listening_intervals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "early_bird_listening_intervals_generation_check" CHECK ("lease_generation" > 0),
    CONSTRAINT "early_bird_listening_intervals_sequence_check" CHECK ("presence_sequence" >= 0),
    CONSTRAINT "early_bird_listening_intervals_order_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
    CONSTRAINT "early_bird_listening_intervals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "early_bird_users"("id") ON DELETE CASCADE,
    CONSTRAINT "early_bird_listening_intervals_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "early_bird_stream_leases"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "early_bird_listening_intervals_lease_id_lease_generation_presence_sequence_key"
    ON "early_bird_listening_intervals"("lease_id", "lease_generation", "presence_sequence");
CREATE INDEX "early_bird_listening_intervals_account_id_started_at_ended_at_idx"
    ON "early_bird_listening_intervals"("account_id", "started_at", "ended_at");
CREATE INDEX "early_bird_listening_intervals_ended_at_last_heartbeat_at_idx"
    ON "early_bird_listening_intervals"("ended_at", "last_heartbeat_at");

COMMENT ON TABLE "early_bird_listening_intervals" IS
    'Server-observed Listener playback spans; open rows are bounded by last heartbeat plus the heartbeat grace window.';
