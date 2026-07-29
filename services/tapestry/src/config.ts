/**
 * Tapestry service configuration.
 *
 * All configuration comes from the environment. The two secrets/settings that
 * must always be present are TAPESTRY_INTERNAL_SECRET (shared with the Next.js
 * app) and TAPESTRY_SESSION_IDS (the seeded session identifiers the service
 * will accept frames for). Everything else has a bounded default; the numeric
 * knobs are overridable in tests via {@link createConfig} partials.
 */

export interface TapestryConfig {
  /** TCP port the internal HTTP server listens on. */
  port: number;
  /** Bind address. Loopback locally; 0.0.0.0 inside the container (internal network only). */
  host: string;
  /** Shared secret the app sends in the x-tapestry-internal-secret header. */
  internalSecret: string;
  /** Seeded session IDs; ingest for any other session is rejected. */
  sessionIds: string[];
  /** Maximum accepted JPEG body size in bytes. */
  maxFrameBytes: number;
  /** How long a participant's latest frame is retained without a refresh. */
  frameTtlMs: number;
  /** Maximum distinct participant identities per session. */
  maxParticipantsPerSession: number;
  /** Square tile edge in pixels. */
  tileSizePx: number;
  /** Grid columns; rows are derived from the participant cap. */
  gridColumns: number;
  /** Minimum time between composite rebuilds for one session. */
  compositeMinIntervalMs: number;
  /** How often expired frames are swept. */
  sweepIntervalMs: number;
  /** JPEG quality of the composite output. */
  compositeJpegQuality: number;
}

export const DEFAULTS = {
  port: 3100,
  host: "127.0.0.1",
  maxFrameBytes: 20 * 1024,
  frameTtlMs: 10_000,
  maxParticipantsPerSession: 150,
  tileSizePx: 100,
  gridColumns: 15,
  compositeMinIntervalMs: 1_000,
  sweepIntervalMs: 500,
  compositeJpegQuality: 80,
} as const;

function parseIdList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/** Opaque IDs supplied by the app: URL-safe, length-bounded, never logged. */
export function isValidOpaqueId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

/**
 * Build the runtime configuration from the process environment.
 * Fails closed: a missing secret or session list is a startup error.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): TapestryConfig {
  const internalSecret = env.TAPESTRY_INTERNAL_SECRET ?? "";
  const sessionIds = parseIdList(env.TAPESTRY_SESSION_IDS);

  if (internalSecret.length < 16) {
    throw new Error("TAPESTRY_INTERNAL_SECRET is required (at least 16 characters)");
  }
  if (sessionIds.length === 0) {
    throw new Error("TAPESTRY_SESSION_IDS is required (comma-separated opaque session IDs)");
  }
  for (const id of sessionIds) {
    if (!isValidOpaqueId(id)) {
      throw new Error(`TAPESTRY_SESSION_IDS contains an invalid session ID shape`);
    }
  }

  return {
    port: Number.parseInt(env.TAPESTRY_PORT ?? "", 10) || DEFAULTS.port,
    host: env.TAPESTRY_HOST ?? DEFAULTS.host,
    internalSecret,
    sessionIds,
    maxFrameBytes: DEFAULTS.maxFrameBytes,
    frameTtlMs: DEFAULTS.frameTtlMs,
    maxParticipantsPerSession: DEFAULTS.maxParticipantsPerSession,
    tileSizePx: DEFAULTS.tileSizePx,
    gridColumns: DEFAULTS.gridColumns,
    compositeMinIntervalMs: DEFAULTS.compositeMinIntervalMs,
    sweepIntervalMs: DEFAULTS.sweepIntervalMs,
    compositeJpegQuality: DEFAULTS.compositeJpegQuality,
  };
}
