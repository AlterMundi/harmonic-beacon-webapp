ALTER TABLE "web_sessions"
    ADD COLUMN "account_email" TEXT,
    ADD COLUMN "account_email_verified" BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "account_auth_method" VARCHAR(16);

ALTER TABLE "web_sessions"
    ADD CONSTRAINT "web_sessions_account_auth_method_check"
        CHECK (
            "account_auth_method" IS NULL
            OR "account_auth_method" IN ('email', 'google', 'apple')
        ),
    ADD CONSTRAINT "web_sessions_verified_email_check"
        CHECK (
            "account_email_verified" = FALSE
            OR "account_email" IS NOT NULL
        );
