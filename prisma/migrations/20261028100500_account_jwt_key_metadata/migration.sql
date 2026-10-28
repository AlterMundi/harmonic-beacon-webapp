-- Keep legacy key bytes and IDs. Null metadata inherits the existing configured
-- EdDSA/Ed25519 defaults in the upgraded JWT plugin; no key rotation is needed.
BEGIN;
ALTER TABLE "beacon_jwks" ADD COLUMN "alg" TEXT, ADD COLUMN "crv" TEXT;
COMMIT;
