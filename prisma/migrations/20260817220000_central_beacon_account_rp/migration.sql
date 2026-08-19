-- Central Beacon Account relying-party bridge for Live/Ops.
-- All columns are additive and nullable so the feature can remain default-off
-- while existing event sessions and rollback images continue to operate.

ALTER TABLE "ticket_entitlements" ADD COLUMN "account_id" TEXT;
ALTER TABLE "ticket_entitlements" ADD COLUMN "account_issuer" TEXT;

ALTER TABLE "web_sessions"
    ADD COLUMN "account_issuer" TEXT,
    ADD COLUMN "account_subject" TEXT,
    ADD COLUMN "account_session_id" TEXT,
    ADD COLUMN "account_display_name" TEXT,
    ADD COLUMN "account_validated_at" TIMESTAMP(3);

ALTER TABLE "session_participants" ADD COLUMN "display_name" TEXT;

-- The original experimental constraints modeled email as the only attendee
-- binding and required every local session to already have a ticket or staff
-- principal. Account mode adds a short-lived account-only step before a ticket
-- is attached, and replaces email authority with exact issuer + opaque subject.
ALTER TABLE "ticket_entitlements" DROP CONSTRAINT "ticket_entitlements_binding_check";
ALTER TABLE "ticket_entitlements"
    ADD CONSTRAINT "ticket_entitlements_account_pair_check" CHECK (
        ("account_issuer" IS NULL AND "account_id" IS NULL)
        OR ("account_issuer" IS NOT NULL AND "account_id" IS NOT NULL)
    ),
    ADD CONSTRAINT "ticket_entitlements_binding_check" CHECK (
        (
            "state" = 'BOUND'
            AND "bound_at" IS NOT NULL
            AND (
                "bound_email" IS NOT NULL
                OR ("account_issuer" IS NOT NULL AND "account_id" IS NOT NULL)
            )
        )
        OR ("state" <> 'BOUND')
    );

ALTER TABLE "web_sessions" DROP CONSTRAINT "web_sessions_one_principal_check";
ALTER TABLE "web_sessions"
    ADD CONSTRAINT "web_sessions_account_tuple_check" CHECK (
        (
            "account_issuer" IS NULL
            AND "account_subject" IS NULL
            AND "account_session_id" IS NULL
            AND "account_validated_at" IS NULL
        )
        OR (
            "account_issuer" IS NOT NULL
            AND "account_subject" IS NOT NULL
            AND "account_session_id" IS NOT NULL
            AND "account_validated_at" IS NOT NULL
        )
    ),
    ADD CONSTRAINT "web_sessions_one_principal_check" CHECK (
        ("staff_user_id" IS NOT NULL)::integer
        + ("ticket_entitlement_id" IS NOT NULL)::integer <= 1
        AND (
            "staff_user_id" IS NOT NULL
            OR "ticket_entitlement_id" IS NOT NULL
            OR "account_subject" IS NOT NULL
        )
    );

CREATE TABLE "staff_account_bindings" (
    "id" UUID NOT NULL,
    "account_issuer" TEXT NOT NULL,
    "account_subject" TEXT NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMP(3),
    CONSTRAINT "staff_account_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "account_login_attempts" (
    "state_digest" CHAR(64) NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "flow" VARCHAR(16) NOT NULL,
    "return_to" TEXT NOT NULL,
    "pending_promo_digest" CHAR(64),
    "pending_display_name" TEXT,
    "pending_terms_version" TEXT,
    "pending_terms_accepted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_login_attempts_pkey" PRIMARY KEY ("state_digest"),
    CONSTRAINT "account_login_attempts_flow_check" CHECK ("flow" IN ('attendee', 'staff'))
);

CREATE INDEX "ticket_entitlements_account_issuer_account_id_idx" ON "ticket_entitlements"("account_issuer", "account_id");
CREATE INDEX "web_sessions_account_issuer_account_subject_idx" ON "web_sessions"("account_issuer", "account_subject");
CREATE INDEX "web_sessions_account_issuer_account_session_id_idx" ON "web_sessions"("account_issuer", "account_session_id");
CREATE UNIQUE INDEX "staff_account_bindings_staff_user_id_key" ON "staff_account_bindings"("staff_user_id");
CREATE UNIQUE INDEX "staff_account_bindings_account_issuer_account_subject_key" ON "staff_account_bindings"("account_issuer", "account_subject");
CREATE INDEX "account_login_attempts_expires_at_idx" ON "account_login_attempts"("expires_at");

ALTER TABLE "staff_account_bindings"
    ADD CONSTRAINT "staff_account_bindings_staff_user_id_fkey"
    FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
