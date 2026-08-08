CREATE TABLE "early_bird_founder_eligibility_projections" (
    "account_id" TEXT NOT NULL,
    "offer_code" VARCHAR(128) NOT NULL,
    "offer_revision" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "billing_period" VARCHAR(32) NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "eligibility_hash" CHAR(64) NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "early_bird_founder_eligibility_projections_pkey" PRIMARY KEY ("account_id"),
    CONSTRAINT "early_bird_founder_eligibility_offer_code_check"
        CHECK ("offer_code" = 'EARLY_BIRDS_FOUNDERS_V1'),
    CONSTRAINT "early_bird_founder_eligibility_offer_revision_check"
        CHECK ("offer_revision" >= 1),
    CONSTRAINT "early_bird_founder_eligibility_currency_check"
        CHECK ("currency" = 'USD'),
    CONSTRAINT "early_bird_founder_eligibility_amount_check"
        CHECK ("amount_minor" = 200),
    CONSTRAINT "early_bird_founder_eligibility_period_check"
        CHECK ("billing_period" = 'MONTHLY'),
    CONSTRAINT "early_bird_founder_eligibility_hash_check"
        CHECK ("eligibility_hash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "early_bird_founder_eligibility_projections_granted_at_idx"
    ON "early_bird_founder_eligibility_projections"("granted_at");

ALTER TABLE "early_bird_founder_eligibility_projections"
    ADD CONSTRAINT "early_bird_founder_eligibility_projections_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "early_bird_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
