ALTER TABLE "scheduled_sessions"
    ADD COLUMN "scene_capacity" INTEGER NOT NULL DEFAULT 6;

ALTER TABLE "scheduled_sessions"
    ADD CONSTRAINT "scheduled_sessions_scene_capacity_check"
    CHECK ("scene_capacity" IN (6, 9, 12));
