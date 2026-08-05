-- CHAT-01 (#137): session-scoped questions + emotions.
--
-- One additive table plus two enum types. No existing table, column or row is
-- touched; the migration runs identically against a clean database and against
-- the current schema. HIDDEN and WITHDRAWN already exist in ContributionState
-- so CHAT-02 moderation/withdrawal transitions need no destructive change.

CREATE TYPE "ContributionVisibility" AS ENUM ('NAMED', 'ANONYMOUS');
CREATE TYPE "ContributionState" AS ENUM ('VISIBLE', 'HIDDEN', 'WITHDRAWN');

CREATE TABLE "session_contributions" (
    "id" UUID NOT NULL,
    "scheduled_session_id" UUID NOT NULL,
    "author_participant_id" UUID NOT NULL,
    "author_display_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "ContributionVisibility" NOT NULL,
    "state" "ContributionState" NOT NULL DEFAULT 'VISIBLE',
    "idempotency_key" TEXT NOT NULL,
    "request_digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "session_contributions_pkey" PRIMARY KEY ("id")
);

-- Idempotency: a retried submission (double click, timeout retry, refresh or
-- reconnect) resolves to the one canonical row per participant and session.
CREATE UNIQUE INDEX "session_contributions_scheduled_session_id_author_participant_id_idempotency_key_key"
    ON "session_contributions" ("scheduled_session_id", "author_participant_id", "idempotency_key");

-- Stable feed order for the bounded public and staff lists.
CREATE INDEX "session_contributions_scheduled_session_id_state_created_at_id_idx"
    ON "session_contributions" ("scheduled_session_id", "state", "created_at", "id");

ALTER TABLE "session_contributions"
    ADD CONSTRAINT "session_contributions_scheduled_session_id_fkey"
    FOREIGN KEY ("scheduled_session_id") REFERENCES "scheduled_sessions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The author link is internal correlation for the future personal follow-up.
-- RESTRICT keeps a participant who published from being deleted under their
-- contributions; withdrawal erases content through state transitions (CHAT-02),
-- never by deleting the participant row.
ALTER TABLE "session_contributions"
    ADD CONSTRAINT "session_contributions_author_participant_id_fkey"
    FOREIGN KEY ("author_participant_id") REFERENCES "session_participants" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
