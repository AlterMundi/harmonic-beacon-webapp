-- Additive provider storage; preserve existing clients, tokens, sessions and revocation constraints.
BEGIN;

-- AlterTable
ALTER TABLE "beacon_oauth_clients" ADD COLUMN     "application_type" TEXT,
ADD COLUMN     "backchannel_logout_session_required" BOOLEAN,
ADD COLUMN     "backchannel_logout_uri" TEXT,
ADD COLUMN     "client_credentials_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "client_discovery_id" TEXT,
ADD COLUMN     "dpop_bound_access_tokens" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jwks" TEXT,
ADD COLUMN     "jwks_uri" TEXT;

-- AlterTable
ALTER TABLE "beacon_oauth_refresh_tokens" ADD COLUMN     "authorization_code_id" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requested_user_info_claims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rotated_at" TIMESTAMP(3),
ADD COLUMN     "rotation_replay_expires_at" TIMESTAMP(3),
ADD COLUMN     "rotation_replay_response" TEXT;

-- AlterTable
ALTER TABLE "beacon_oauth_access_tokens" ADD COLUMN     "authorization_code_id" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requested_user_info_claims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revoked" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "beacon_oauth_consents" ADD COLUMN     "requested_user_info_claims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "beacon_oauth_resources" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "access_token_ttl" INTEGER,
    "refresh_token_ttl" INTEGER,
    "signing_algorithm" TEXT,
    "signing_key_id" TEXT,
    "allowed_scopes" TEXT[],
    "custom_claims" JSONB,
    "dpop_bound_access_tokens_required" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "beacon_oauth_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beacon_oauth_client_resources" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "beacon_oauth_client_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beacon_oauth_client_assertions" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beacon_oauth_client_assertions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "beacon_oauth_resources_identifier_key" ON "beacon_oauth_resources"("identifier");

-- CreateIndex
CREATE INDEX "beacon_oauth_client_resources_client_id_idx" ON "beacon_oauth_client_resources"("client_id");

-- CreateIndex
CREATE INDEX "beacon_oauth_client_resources_resource_id_idx" ON "beacon_oauth_client_resources"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "beacon_oauth_client_resources_client_id_resource_id_key" ON "beacon_oauth_client_resources"("client_id", "resource_id");

-- CreateIndex
CREATE INDEX "beacon_oauth_refresh_tokens_authorization_code_id_idx" ON "beacon_oauth_refresh_tokens"("authorization_code_id");

-- CreateIndex
CREATE INDEX "beacon_oauth_access_tokens_authorization_code_id_idx" ON "beacon_oauth_access_tokens"("authorization_code_id");

-- AddForeignKey
ALTER TABLE "beacon_oauth_client_resources" ADD CONSTRAINT "beacon_oauth_client_resources_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "beacon_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beacon_oauth_client_resources" ADD CONSTRAINT "beacon_oauth_client_resources_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "beacon_oauth_resources"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
