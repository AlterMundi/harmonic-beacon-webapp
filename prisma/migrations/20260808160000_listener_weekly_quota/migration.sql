-- personal-7-day-v1 is a forward-only authorization cutover. Legacy Free
-- schedule/welcome rows remain intact for historical audit and compatibility inspection,
-- but all extant stream leases are evicted so every client reauthorizes.
UPDATE "early_bird_listener_authority_policy"
SET "policy_version" = 'personal-7-day-v1',
    "activated_at" = clock_timestamp()
WHERE "id" = 1 AND "policy_version" = 'legacy-daily-v1';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "early_bird_listener_authority_policy"
        WHERE "id" = 1 AND "policy_version" = 'personal-7-day-v1'
    ) THEN
        RAISE EXCEPTION 'listener weekly policy bridge is missing or incompatible';
    END IF;
END;
$$;

ALTER TABLE "early_bird_stream_leases"
    ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "presence_sequence" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "early_bird_stream_leases_generation_check" CHECK ("generation" > 0),
    ADD CONSTRAINT "early_bird_stream_leases_presence_sequence_check" CHECK ("presence_sequence" >= 0);
CREATE INDEX "early_bird_stream_leases_account_id_presence_evicted_at_expires_at_idx"
    ON "early_bird_stream_leases"("account_id", "presence", "evicted_at", "expires_at");

CREATE TABLE "early_bird_listening_quota_cursors" (
    "account_id" TEXT NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "cycle_anchor_at" TIMESTAMP(3),
    "cycle_started_at" TIMESTAMP(3),
    "cycle_ends_at" TIMESTAMP(3),
    "base_consumed_ms" INTEGER NOT NULL DEFAULT 0,
    "settled_through" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "early_bird_listening_quota_cursors_pkey" PRIMARY KEY ("account_id"),
    CONSTRAINT "early_bird_listening_quota_policy_check" CHECK ("policy_version" = 'personal-7-day-v1'),
    CONSTRAINT "early_bird_listening_quota_base_check" CHECK ("base_consumed_ms" BETWEEN 0 AND 10800000),
    CONSTRAINT "early_bird_listening_quota_cycle_check" CHECK (
        ("cycle_anchor_at" IS NULL AND "cycle_started_at" IS NULL AND "cycle_ends_at" IS NULL AND "settled_through" IS NULL AND "base_consumed_ms" = 0)
        OR
        ("cycle_anchor_at" IS NOT NULL AND "cycle_started_at" IS NOT NULL AND "cycle_ends_at" = "cycle_started_at" + INTERVAL '7 days' AND "settled_through" IS NOT NULL)
    )
);

CREATE INDEX "early_bird_listening_quota_cursors_cycle_ends_at_idx"
    ON "early_bird_listening_quota_cursors"("cycle_ends_at");

ALTER TABLE "early_bird_listening_quota_cursors"
    ADD CONSTRAINT "early_bird_listening_quota_cursors_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "early_bird_quota_cursor_immutable_anchor"() RETURNS trigger AS $$
BEGIN
    IF OLD."policy_version" <> NEW."policy_version"
       OR (OLD."cycle_anchor_at" IS NOT NULL AND OLD."cycle_anchor_at" IS DISTINCT FROM NEW."cycle_anchor_at") THEN
        RAISE EXCEPTION 'listener quota policy/anchor is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "early_bird_quota_cursor_immutable_anchor_trigger"
    BEFORE UPDATE ON "early_bird_listening_quota_cursors"
    FOR EACH ROW EXECUTE FUNCTION "early_bird_quota_cursor_immutable_anchor"();

CREATE TABLE "early_bird_listening_bonus_grants" (
    "id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount_ms" INTEGER NOT NULL,
    "consumed_ms" INTEGER NOT NULL DEFAULT 0,
    "fully_consumed" BOOLEAN NOT NULL DEFAULT false,
    "issuer_code" VARCHAR(32) NOT NULL,
    "source_code" VARCHAR(32) NOT NULL,
    "reason_code" VARCHAR(32) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "available_from" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "early_bird_listening_bonus_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "early_bird_listening_bonus_amount_check" CHECK ("amount_ms" BETWEEN 1 AND 604800000),
    CONSTRAINT "early_bird_listening_bonus_consumed_check" CHECK ("consumed_ms" BETWEEN 0 AND "amount_ms"),
    CONSTRAINT "early_bird_listening_bonus_fully_consumed_check" CHECK (NOT "fully_consumed" OR "consumed_ms" = "amount_ms"),
    CONSTRAINT "early_bird_listening_bonus_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "available_from"),
    CONSTRAINT "early_bird_listening_bonus_issuer_check" CHECK ("issuer_code" IN ('SUPPORT', 'OPERATIONS', 'MIGRATION', 'QUEST_SYSTEM')),
    CONSTRAINT "early_bird_listening_bonus_source_check" CHECK ("source_code" IN ('MANUAL_REMEDIATION', 'SERVICE_RECOVERY', 'POLICY_MIGRATION', 'COLLABORATION_QUEST')),
    CONSTRAINT "early_bird_listening_bonus_reason_check" CHECK ("reason_code" IN ('RESTORE_ACCESS', 'SERVICE_INTERRUPTION', 'CUTOVER_ADJUSTMENT', 'QUEST_COMPLETED'))
);

CREATE UNIQUE INDEX "early_bird_listening_bonus_grants_account_id_issuer_code_idempotency_key_key"
    ON "early_bird_listening_bonus_grants"("account_id", "issuer_code", "idempotency_key");
CREATE INDEX "early_bird_listening_bonus_grants_account_id_fully_consumed_expires_at_available_from_idx"
    ON "early_bird_listening_bonus_grants"("account_id", "fully_consumed", "expires_at", "available_from");

ALTER TABLE "early_bird_listening_bonus_grants"
    ADD CONSTRAINT "early_bird_listening_bonus_grants_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "early_bird_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "early_bird_quota_grant_immutable_facts"() RETURNS trigger AS $$
BEGIN
    IF OLD."id" IS DISTINCT FROM NEW."id"
       OR OLD."account_id" IS DISTINCT FROM NEW."account_id"
       OR OLD."amount_ms" IS DISTINCT FROM NEW."amount_ms"
       OR OLD."issuer_code" IS DISTINCT FROM NEW."issuer_code"
       OR OLD."source_code" IS DISTINCT FROM NEW."source_code"
       OR OLD."reason_code" IS DISTINCT FROM NEW."reason_code"
       OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key"
       OR OLD."request_hash" IS DISTINCT FROM NEW."request_hash"
       OR OLD."granted_at" IS DISTINCT FROM NEW."granted_at"
       OR OLD."available_from" IS DISTINCT FROM NEW."available_from"
       OR OLD."expires_at" IS DISTINCT FROM NEW."expires_at"
       OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
       OR NEW."consumed_ms" < OLD."consumed_ms"
       OR (OLD."fully_consumed" AND NOT NEW."fully_consumed") THEN
        RAISE EXCEPTION 'listener quota grant facts are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "early_bird_quota_grant_immutable_facts_trigger"
    BEFORE UPDATE ON "early_bird_listening_bonus_grants"
    FOR EACH ROW EXECUTE FUNCTION "early_bird_quota_grant_immutable_facts"();

UPDATE "early_bird_stream_leases"
SET "evicted_at" = clock_timestamp(),
    "presence" = 'IDLE',
    "presence_updated_at" = clock_timestamp()
WHERE "evicted_at" IS NULL;
