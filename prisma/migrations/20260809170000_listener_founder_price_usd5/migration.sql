-- No public Founder subscription existed at the previous experimental price. Keep one canonical
-- offer by migrating any synthetic projection and replacing the constraint forward-only.
ALTER TABLE "early_bird_founder_eligibility_projections"
    DROP CONSTRAINT "early_bird_founder_eligibility_amount_check";

UPDATE "early_bird_founder_eligibility_projections"
SET "amount_minor" = 500
WHERE "currency" = 'USD'
  AND "amount_minor" = 200;

ALTER TABLE "early_bird_founder_eligibility_projections"
    ADD CONSTRAINT "early_bird_founder_eligibility_amount_check"
    CHECK ("amount_minor" = 500);
