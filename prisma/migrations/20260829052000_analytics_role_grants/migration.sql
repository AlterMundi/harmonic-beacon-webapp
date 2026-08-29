CREATE TYPE "AnalyticsRole" AS ENUM ('VIEWER', 'EXPORTER');

CREATE TABLE "analytics_role_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_user_id" UUID NOT NULL,
    "role" "AnalyticsRole" NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "granted_by" VARCHAR(64) NOT NULL,
    CONSTRAINT "analytics_role_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analytics_role_grants_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "analytics_role_grants_staff_user_id_key" ON "analytics_role_grants"("staff_user_id");
CREATE INDEX "analytics_role_grants_role_revoked_at_idx" ON "analytics_role_grants"("role", "revoked_at");

COMMENT ON TABLE "analytics_role_grants" IS
    'Explicit analytics-only authorization. ADMIN remains implicitly authorized; no event authority is granted here.';
