-- Rollback bridge installed before the personal weekly quota cutover. The
-- legacy Listener image accepts only legacy-daily-v1; the weekly migration
-- atomically advances this row so every bridge image fails closed thereafter.
CREATE TABLE "early_bird_listener_authority_policy" (
    "id" INTEGER NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "early_bird_listener_authority_policy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "early_bird_listener_authority_policy_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "early_bird_listener_authority_policy_version_check"
        CHECK ("policy_version" IN ('legacy-daily-v1', 'personal-7-day-v1'))
);

INSERT INTO "early_bird_listener_authority_policy" ("id", "policy_version")
VALUES (1, 'legacy-daily-v1');
