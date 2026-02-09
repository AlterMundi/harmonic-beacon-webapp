-- CreateTable
CREATE TABLE "session_recordings" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "egress_id" TEXT NOT NULL,
    "track_sid" TEXT NOT NULL,
    "room_name" TEXT NOT NULL,
    "participant_identity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "file_path" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMP(3),

    CONSTRAINT "session_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_recordings_session_id_idx" ON "session_recordings"("session_id");

-- AddForeignKey
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduled_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropColumns
ALTER TABLE "scheduled_sessions" DROP COLUMN IF EXISTS "recording_path";
ALTER TABLE "scheduled_sessions" DROP COLUMN IF EXISTS "egress_id";
ALTER TABLE "scheduled_sessions" DROP COLUMN IF EXISTS "beacon_recording_path";
ALTER TABLE "scheduled_sessions" DROP COLUMN IF EXISTS "beacon_egress_id";
