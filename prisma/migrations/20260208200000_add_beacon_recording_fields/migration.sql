-- AlterTable
ALTER TABLE "scheduled_sessions" ADD COLUMN "beacon_recording_path" TEXT,
ADD COLUMN "beacon_egress_id" TEXT;
