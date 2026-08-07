CREATE TYPE "ListenerMacroRegion" AS ENUM (
  'NORTH_AMERICA',
  'LATIN_AMERICA',
  'EUROPE',
  'AFRICA',
  'ASIA',
  'OCEANIA',
  'UNKNOWN'
);

CREATE TYPE "ListenerPresenceState" AS ENUM ('IDLE', 'LISTENING');

ALTER TABLE "early_bird_stream_leases"
  ADD COLUMN "presence" "ListenerPresenceState" NOT NULL DEFAULT 'IDLE',
  ADD COLUMN "macro_region" "ListenerMacroRegion" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "presence_updated_at" TIMESTAMP(3);

CREATE INDEX "early_bird_stream_leases_presence_presence_updated_at_expires_idx"
  ON "early_bird_stream_leases"("presence", "presence_updated_at", "expires_at");
