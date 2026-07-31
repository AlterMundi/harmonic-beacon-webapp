-- Test visibility is durable data, never inferred from mutable display copy.
-- The default keeps every existing and future production event public unless
-- an explicit writer marks it as a test fixture.
ALTER TABLE "scheduled_sessions"
ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;

-- These are the only deterministic fixtures shipped by this repository.
-- Restrict the one-time backfill to their stable UUIDs so a real event whose
-- title happens to contain "test" is never hidden.
UPDATE "scheduled_sessions"
SET "is_test" = true
WHERE "id" IN (
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000102'
);
