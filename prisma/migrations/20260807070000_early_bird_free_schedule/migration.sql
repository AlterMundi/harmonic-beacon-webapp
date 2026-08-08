CREATE TABLE "early_bird_free_schedules" (
    "account_id" TEXT NOT NULL,
    "time_zone" VARCHAR(64) NOT NULL,
    "local_start_minute" INTEGER NOT NULL,
    "selected_at" TIMESTAMP(3) NOT NULL,
    "change_allowed_at" TIMESTAMP(3) NOT NULL,
    "selection_request_id" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "early_bird_free_schedules_pkey" PRIMARY KEY ("account_id"),
    CONSTRAINT "early_bird_free_schedules_local_start_minute_check"
        CHECK ("local_start_minute" >= 0 AND "local_start_minute" < 1440),
    CONSTRAINT "early_bird_free_schedules_revision_check"
        CHECK ("revision" >= 1),
    CONSTRAINT "early_bird_free_schedules_change_after_selection_check"
        CHECK ("change_allowed_at" >= "selected_at")
);

CREATE UNIQUE INDEX "early_bird_free_schedules_selection_request_id_key"
    ON "early_bird_free_schedules"("selection_request_id");
CREATE INDEX "early_bird_free_schedules_change_allowed_at_idx"
    ON "early_bird_free_schedules"("change_allowed_at");

ALTER TABLE "early_bird_free_schedules"
    ADD CONSTRAINT "early_bird_free_schedules_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "early_bird_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
