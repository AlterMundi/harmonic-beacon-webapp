-- Controlled, session-scoped complimentary invitations. Raw promotion codes
-- are never stored: only a peppered digest crosses the persistence boundary.
CREATE TYPE "PromoInvitationStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "promo_invitations" (
    "id" UUID NOT NULL,
    "scheduled_session_id" UUID NOT NULL,
    "code_digest" CHAR(64) NOT NULL,
    "label" TEXT NOT NULL,
    "status" "PromoInvitationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_redemptions" INTEGER NOT NULL,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "issued_by_user_id" UUID NOT NULL,
    "disabled_at" TIMESTAMP(3),
    "disabled_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promo_invitations_capacity_check" CHECK (
        "max_redemptions" > 0 AND
        "redemption_count" >= 0 AND
        "redemption_count" <= "max_redemptions"
    ),
    CONSTRAINT "promo_invitations_disabled_check" CHECK (
        ("status" = 'ACTIVE' AND "disabled_at" IS NULL) OR
        ("status" = 'DISABLED' AND "disabled_at" IS NOT NULL)
    )
);

CREATE TABLE "promo_redemptions" (
    "id" UUID NOT NULL,
    "promo_invitation_id" UUID NOT NULL,
    "redeemer_digest" CHAR(64) NOT NULL,
    "ticket_entitlement_id" UUID NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promo_invitations_code_digest_key"
    ON "promo_invitations"("code_digest");
CREATE INDEX "promo_invitations_scheduled_session_id_status_expires_at_idx"
    ON "promo_invitations"("scheduled_session_id", "status", "expires_at");
CREATE UNIQUE INDEX "promo_redemptions_ticket_entitlement_id_key"
    ON "promo_redemptions"("ticket_entitlement_id");
CREATE UNIQUE INDEX "promo_redemptions_promo_invitation_id_redeemer_digest_key"
    ON "promo_redemptions"("promo_invitation_id", "redeemer_digest");

ALTER TABLE "promo_invitations"
    ADD CONSTRAINT "promo_invitations_scheduled_session_id_fkey"
    FOREIGN KEY ("scheduled_session_id") REFERENCES "scheduled_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_invitations"
    ADD CONSTRAINT "promo_invitations_issued_by_user_id_fkey"
    FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_invitations"
    ADD CONSTRAINT "promo_invitations_disabled_by_user_id_fkey"
    FOREIGN KEY ("disabled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_promo_invitation_id_fkey"
    FOREIGN KEY ("promo_invitation_id") REFERENCES "promo_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_ticket_entitlement_id_fkey"
    FOREIGN KEY ("ticket_entitlement_id") REFERENCES "ticket_entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
