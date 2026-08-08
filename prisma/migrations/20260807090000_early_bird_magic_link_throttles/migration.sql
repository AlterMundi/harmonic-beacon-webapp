CREATE TABLE "early_bird_magic_link_throttles" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "window_started_at" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "early_bird_magic_link_throttles_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "early_bird_magic_link_throttles_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "early_bird_magic_link_throttles_kind_check" CHECK ("kind" IN ('email', 'origin_ip'))
);

CREATE INDEX "early_bird_magic_link_throttles_updated_at_idx"
    ON "early_bird_magic_link_throttles"("updated_at");
