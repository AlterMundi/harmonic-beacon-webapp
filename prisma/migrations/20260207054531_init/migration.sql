-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('LISTENER', 'PROVIDER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('LIVE', 'MEDITATION');

-- CreateEnum
CREATE TYPE "TagCategory" AS ENUM ('MOOD', 'TECHNIQUE', 'DURATION', 'LANGUAGE');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "zitadel_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'LISTENER',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meditations" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "duration_seconds" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "original_path" TEXT,
    "stream_name" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meditations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "TagCategory" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meditation_tags" (
    "meditation_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "meditation_tags_pkey" PRIMARY KEY ("meditation_id","tag_id")
);

-- CreateTable
CREATE TABLE "listening_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "meditation_id" TEXT,
    "type" "SessionType" NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "listening_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" TEXT NOT NULL,
    "meditation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","meditation_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_zitadel_id_key" ON "users"("zitadel_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "meditations_stream_name_key" ON "meditations"("stream_name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "listening_sessions_user_id_started_at_idx" ON "listening_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "listening_sessions_meditation_id_idx" ON "listening_sessions"("meditation_id");

-- AddForeignKey
ALTER TABLE "meditations" ADD CONSTRAINT "meditations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meditation_tags" ADD CONSTRAINT "meditation_tags_meditation_id_fkey" FOREIGN KEY ("meditation_id") REFERENCES "meditations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meditation_tags" ADD CONSTRAINT "meditation_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_sessions" ADD CONSTRAINT "listening_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_sessions" ADD CONSTRAINT "listening_sessions_meditation_id_fkey" FOREIGN KEY ("meditation_id") REFERENCES "meditations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_meditation_id_fkey" FOREIGN KEY ("meditation_id") REFERENCES "meditations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
