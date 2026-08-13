-- Public, no-login consumer withdrawal queue. This is additive and has no
-- relation to event, staff, playback or canonical payment tables.
CREATE TYPE "ListenerWithdrawalProvider" AS ENUM ('PAYPAL', 'MERCADO_PAGO', 'OTHER');
CREATE TYPE "ListenerWithdrawalStatus" AS ENUM ('RECEIVED', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "ListenerConsumerRequestKind" AS ENUM ('WITHDRAWAL', 'SERVICE_CANCELLATION');

CREATE TABLE "listener_withdrawal_requests" (
    "id" UUID NOT NULL,
    "receipt_digest" CHAR(64) NOT NULL,
    "receipt_last_four" CHAR(4) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "contact_email" VARCHAR(254) NOT NULL,
    "request_kind" "ListenerConsumerRequestKind" NOT NULL,
    "provider" "ListenerWithdrawalProvider" NOT NULL,
    "purchase_date" DATE,
    "locale" CHAR(2) NOT NULL,
    "status" "ListenerWithdrawalStatus" NOT NULL DEFAULT 'RECEIVED',
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" VARCHAR(64),
    "resolved_at" TIMESTAMP(3),
    "resolved_by" VARCHAR(64),
    "resolution_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listener_withdrawal_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "listener_withdrawal_requests_receipt_digest_check"
        CHECK ("receipt_digest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "listener_withdrawal_requests_receipt_last_four_check"
        CHECK ("receipt_last_four" ~ '^[0-9A-F]{4}$'),
    CONSTRAINT "listener_withdrawal_requests_request_hash_check"
        CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "listener_withdrawal_requests_email_check"
        CHECK (length("contact_email") BETWEEN 3 AND 254 AND "contact_email" = lower("contact_email")),
    CONSTRAINT "listener_withdrawal_requests_locale_check"
        CHECK ("locale" IN ('es', 'en')),
    CONSTRAINT "listener_withdrawal_requests_ack_check" CHECK (
        ("status" = 'RECEIVED' AND "acknowledged_at" IS NULL AND "acknowledged_by" IS NULL
          AND "resolved_at" IS NULL AND "resolved_by" IS NULL AND "resolution_code" IS NULL)
        OR
        ("status" = 'ACKNOWLEDGED' AND "acknowledged_at" IS NOT NULL AND "acknowledged_by" IS NOT NULL
          AND "resolved_at" IS NULL AND "resolved_by" IS NULL AND "resolution_code" IS NULL)
        OR
        ("status" = 'RESOLVED' AND "acknowledged_at" IS NOT NULL AND "acknowledged_by" IS NOT NULL
          AND "resolved_at" IS NOT NULL AND "resolved_by" IS NOT NULL AND "resolution_code" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "listener_withdrawal_requests_receipt_digest_key"
    ON "listener_withdrawal_requests"("receipt_digest");
CREATE UNIQUE INDEX "listener_withdrawal_requests_idempotency_key_key"
    ON "listener_withdrawal_requests"("idempotency_key");
CREATE INDEX "listener_withdrawal_requests_status_created_at_idx"
    ON "listener_withdrawal_requests"("status", "created_at");
CREATE INDEX "listener_withdrawal_requests_created_at_idx"
    ON "listener_withdrawal_requests"("created_at");

CREATE TABLE "listener_withdrawal_throttles" (
    "key" VARCHAR(72) NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listener_withdrawal_throttles_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "listener_withdrawal_throttles_key_check"
        CHECK ("key" = 'global' OR "key" ~ '^(network|email):[0-9a-f]{64}$'),
    CONSTRAINT "listener_withdrawal_throttles_attempts_check"
        CHECK ("attempts" >= 0)
);

CREATE INDEX "listener_withdrawal_throttles_updated_at_idx"
    ON "listener_withdrawal_throttles"("updated_at");
