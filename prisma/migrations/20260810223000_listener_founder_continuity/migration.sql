-- The positive-only eligibility projection encoded an unreleased experimental
-- policy. Founder price now survives only while one canonical service episode
-- remains uninterrupted, so current continuity travels atomically with the
-- membership revision. Existing rows are synthetic and intentionally do not
-- grandfather an account into the replacement policy.
CREATE TYPE "EarlyBirdFounderContinuityState" AS ENUM (
    'ACTIVE',
    'CANCELLED_PENDING_END',
    'GRACE',
    'ENDED'
);

ALTER TABLE "early_bird_membership_projections"
    ADD COLUMN "founder_continuity_episode_id" UUID,
    ADD COLUMN "founder_continuity_revision" INTEGER,
    ADD COLUMN "founder_continuity_state" "EarlyBirdFounderContinuityState",
    ADD COLUMN "founder_continuity_offer_code" VARCHAR(128),
    ADD COLUMN "founder_continuity_offer_revision" INTEGER,
    ADD COLUMN "founder_continuity_currency" CHAR(3),
    ADD COLUMN "founder_continuity_amount_minor" INTEGER,
    ADD COLUMN "founder_continuity_billing_period" VARCHAR(32),
    ADD COLUMN "founder_continuity_activated_at" TIMESTAMP(3),
    ADD COLUMN "founder_continuity_service_through" TIMESTAMP(3),
    ADD COLUMN "founder_continuity_ended_at" TIMESTAMP(3),
    ADD COLUMN "founder_continuity_terminal_reason" VARCHAR(64);

ALTER TABLE "early_bird_membership_projections"
    ADD CONSTRAINT "early_bird_founder_continuity_complete_check" CHECK (
        (
            "founder_continuity_episode_id" IS NULL
            AND "founder_continuity_revision" IS NULL
            AND "founder_continuity_state" IS NULL
            AND "founder_continuity_offer_code" IS NULL
            AND "founder_continuity_offer_revision" IS NULL
            AND "founder_continuity_currency" IS NULL
            AND "founder_continuity_amount_minor" IS NULL
            AND "founder_continuity_billing_period" IS NULL
            AND "founder_continuity_activated_at" IS NULL
            AND "founder_continuity_service_through" IS NULL
            AND "founder_continuity_ended_at" IS NULL
            AND "founder_continuity_terminal_reason" IS NULL
        ) OR (
            "founder_continuity_episode_id" IS NOT NULL
            AND "founder_continuity_revision" >= 1
            AND "founder_continuity_state" IS NOT NULL
            AND "founder_continuity_offer_code" = 'EARLY_BIRDS_FOUNDERS_V1'
            AND "founder_continuity_offer_revision" >= 1
            AND "founder_continuity_currency" = 'USD'
            AND "founder_continuity_amount_minor" = 500
            AND "founder_continuity_billing_period" = 'MONTHLY'
            AND "founder_continuity_activated_at" IS NOT NULL
            AND (
                (
                    "founder_continuity_state" = 'ENDED'
                    AND "founder_continuity_ended_at" IS NOT NULL
                    AND "founder_continuity_terminal_reason" IS NOT NULL
                ) OR (
                    "founder_continuity_state" <> 'ENDED'
                    AND "founder_continuity_service_through" IS NOT NULL
                    AND "founder_continuity_ended_at" IS NULL
                    AND "founder_continuity_terminal_reason" IS NULL
                )
            )
        )
    );

CREATE INDEX "early_bird_membership_projections_founder_continuity_state_service_through_idx"
    ON "early_bird_membership_projections"("founder_continuity_state", "founder_continuity_service_through");

-- No public Listener membership exists yet. Retire every v1 command hash and
-- revision before command.v2 starts: otherwise a command.v2 delivery using
-- the same membership_revision would correctly conflict with the old bytes and
-- could never converge. Preserve the complete pre-cutover row for audit, then
-- leave the runtime projection empty so its first command.v2 is authoritative.
CREATE TABLE "early_bird_retired_membership_projection_audit"
    AS TABLE "early_bird_membership_projections" WITH NO DATA;

INSERT INTO "early_bird_retired_membership_projection_audit"
SELECT * FROM "early_bird_membership_projections";

DELETE FROM "early_bird_membership_projections";

COMMENT ON TABLE "early_bird_retired_membership_projection_audit" IS
    'Pre-release membership command.v1 projections; audit only, never runtime authority';

-- Retain the synthetic pre-release rows strictly as audit history. The renamed
-- table has no Prisma model or runtime reader/writer, so it cannot authorize or
-- price a Listener while still documenting what the experiment projected.
ALTER TABLE "early_bird_founder_eligibility_projections"
    RENAME TO "early_bird_retired_founder_eligibility_audit";

COMMENT ON TABLE "early_bird_retired_founder_eligibility_audit" IS
    'Retired experimental positive-only Founder eligibility; audit only, never authority';
