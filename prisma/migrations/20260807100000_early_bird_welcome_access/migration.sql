CREATE TABLE "early_bird_welcome_accesses" (
    "account_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "activation_request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "early_bird_welcome_accesses_pkey" PRIMARY KEY ("account_id"),
    CONSTRAINT "early_bird_welcome_accesses_duration_check"
        CHECK ("ends_at" = "started_at" + INTERVAL '30 minutes')
);

CREATE UNIQUE INDEX "early_bird_welcome_accesses_activation_request_id_key"
    ON "early_bird_welcome_accesses"("activation_request_id");
CREATE INDEX "early_bird_welcome_accesses_ends_at_idx"
    ON "early_bird_welcome_accesses"("ends_at");

ALTER TABLE "early_bird_welcome_accesses"
    ADD CONSTRAINT "early_bird_welcome_accesses_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "early_bird_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
