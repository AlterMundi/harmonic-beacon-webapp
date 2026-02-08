-- CreateEnum
CREATE TYPE "ScheduledSessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "SessionType" ADD VALUE 'SCHEDULED_SESSION';

-- AlterTable
ALTER TABLE "listening_sessions" ADD COLUMN     "scheduled_session_id" TEXT;

-- CreateTable
CREATE TABLE "scheduled_sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "room_name" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "status" "ScheduledSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "recording_path" TEXT,
    "duration_seconds" INTEGER,
    "egress_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_invites" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 0,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "can_publish" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_participants" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,

    CONSTRAINT "session_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_sessions_room_name_key" ON "scheduled_sessions"("room_name");

-- CreateIndex
CREATE INDEX "scheduled_sessions_provider_id_idx" ON "scheduled_sessions"("provider_id");

-- CreateIndex
CREATE INDEX "scheduled_sessions_status_idx" ON "scheduled_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "session_invites_code_key" ON "session_invites"("code");

-- CreateIndex
CREATE INDEX "session_invites_session_id_idx" ON "session_invites"("session_id");

-- CreateIndex
CREATE INDEX "session_participants_user_id_idx" ON "session_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_participants_session_id_user_id_key" ON "session_participants"("session_id", "user_id");

-- CreateIndex
CREATE INDEX "listening_sessions_scheduled_session_id_idx" ON "listening_sessions"("scheduled_session_id");

-- AddForeignKey
ALTER TABLE "listening_sessions" ADD CONSTRAINT "listening_sessions_scheduled_session_id_fkey" FOREIGN KEY ("scheduled_session_id") REFERENCES "scheduled_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_sessions" ADD CONSTRAINT "scheduled_sessions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_invites" ADD CONSTRAINT "session_invites_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduled_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduled_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
