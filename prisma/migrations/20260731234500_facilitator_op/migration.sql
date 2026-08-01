-- Additive first: older application versions can continue reading existing
-- roles until a user is explicitly assigned FACILITATOR_OP.
ALTER TYPE "StaffRole" ADD VALUE 'FACILITATOR_OP';

-- Preserve the role used for an audited action even if the user's current
-- role changes later. Existing rows remain valid with a null snapshot.
ALTER TABLE "audit_logs" ADD COLUMN "actor_role" "StaffRole";
