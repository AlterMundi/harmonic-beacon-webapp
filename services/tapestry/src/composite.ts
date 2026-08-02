/**
 * Composite rendering for the tapestry service.
 *
 * The grid is sized for the ACTIVE participants, not the session cap: with
 * three people online the composite is a 3-tile strip, not a 150-slot wall.
 * Columns fill up to gridColumns before a new row opens, so existing tiles
 * keep their positions as participants join within a row. Rebuilds are
 * rate-limited to at most one per interval per session and skipped entirely
 * while the session's frame set is unchanged; in between, the last built
 * JPEG is served from memory.
 */

import sharp from "sharp";

import type { TapestryConfig } from "./config.js";
import type { TapestryStore } from "./store.js";

// Bound native work and caching: one libvips worker is plenty for 100px
// tiles, and a small operation cache keeps RSS predictable inside the
// container's memory limit.
sharp.concurrency(1);
sharp.cache({ memory: 16, files: 0, items: 20 });

interface CompositeCacheEntry {
  jpeg: Buffer;
  builtAtMs: number;
  inFlight: Promise<Buffer> | null;
  /** Monotonic store revision; every ingest/sweep/arrangement advances it. */
  revision: number;
  /** Revision captured by the last successfully completed composite. */
  builtRevision: number;
  /** A staff change newer than builtRevision bypasses the ingest rate limit. */
  urgentRevision: number;
}

export class TapestryCompositor {
  private readonly cache = new Map<string, CompositeCacheEntry>();
  private readonly gridWidthPx: number;
  private readonly gridHeightPx: number;
  private compositesBuilt = 0;

  constructor(
    private readonly config: TapestryConfig,
    private readonly store: TapestryStore,
    private readonly nowMs: () => number = () => Date.now(),
  ) {
    const rows = Math.ceil(config.maxParticipantsPerSession / config.gridColumns);
    this.gridWidthPx = config.gridColumns * config.tileSizePx;
    this.gridHeightPx = rows * config.tileSizePx;
    for (const sessionId of config.sessionIds) {
      this.cache.set(sessionId, {
        jpeg: Buffer.alloc(0),
        builtAtMs: 0,
        inFlight: null,
        revision: 1,
        builtRevision: 0,
        urgentRevision: 0,
      });
    }
  }

  /** Mark a session's composite stale (called on ingest and on expiry sweeps). */
  markDirty(sessionId: string, immediate = false): void {
    const entry = this.cache.get(sessionId);
    if (entry) {
      entry.revision += 1;
      // Staff actions (arrangement changes) must be visible at once — the
      // rate limit exists to bound ingest-driven rebuild churn, not to make
      // the ops console feel broken.
      if (immediate) {
        entry.urgentRevision = entry.revision;
      }
    }
  }

  compositesBuiltCount(): number {
    return this.compositesBuilt;
  }

  gridDimensionsPx(): { width: number; height: number } {
    return { width: this.gridWidthPx, height: this.gridHeightPx };
  }

  /**
   * Return the current composite JPEG for a session. Serves the cached image
   * when it is fresh enough or nothing changed; otherwise rebuilds, at most
   * once per compositeMinIntervalMs per session. Concurrent callers share one
   * in-flight rebuild.
   */
  async composite(sessionId: string): Promise<Buffer | null> {
    const entry = this.cache.get(sessionId);
    if (!entry) {
      return null;
    }
    if (entry.inFlight) {
      return entry.inFlight;
    }

    const now = this.nowMs();
    const dirty = entry.builtRevision !== entry.revision;
    const urgent = entry.urgentRevision > entry.builtRevision;
    const freshEnough =
      !dirty || (!urgent && now - entry.builtAtMs < this.config.compositeMinIntervalMs);
    if (entry.jpeg.length > 0 && freshEnough) {
      return entry.jpeg;
    }

    // `build()` snapshots the store synchronously before libvips starts its
    // asynchronous encoding. Only this captured revision may be marked built:
    // a later ingest must remain pending when this promise settles.
    const buildRevision = entry.revision;
    entry.inFlight = this.build(sessionId)
      .then((jpeg) => {
        entry.jpeg = jpeg;
        entry.builtAtMs = this.nowMs();
        entry.builtRevision = buildRevision;
        if (entry.urgentRevision <= buildRevision) {
          entry.urgentRevision = 0;
        }
        this.compositesBuilt += 1;
        return jpeg;
      })
      .finally(() => {
        entry.inFlight = null;
      });
    return entry.inFlight;
  }

  private async build(sessionId: string): Promise<Buffer> {
    // Display order = staff arrangement first, then first-seen (store.orderedActive).
    const participants = this.store.orderedActive(
      sessionId,
      this.nowMs(),
      this.config.frameTtlMs,
    );
    const tile = this.config.tileSizePx;
    // Dynamic grid: never larger than the active set needs (1x1 when empty).
    const columns = Math.max(1, Math.min(this.config.gridColumns, participants.length));
    const rows = Math.max(1, Math.ceil(participants.length / columns));
    const inputs = participants.map(({ participant }, index) => ({
      input: participant.tile,
      left: (index % columns) * tile,
      top: Math.floor(index / columns) * tile,
    }));

    return sharp({
      create: {
        width: columns * tile,
        height: rows * tile,
        channels: 3,
        background: { r: 17, g: 17, b: 17 },
      },
    })
      .composite(inputs)
      .jpeg({ quality: this.config.compositeJpegQuality })
      .toBuffer();
  }
}

/**
 * Decode an ingested frame into a normalized square tile. Rejects anything
 * sharp cannot decode as an image, so invalid "JPEG" bodies never reach the
 * store. The raw frame is dropped here; only the small tile is retained.
 */
export async function frameToTile(frame: Buffer, tileSizePx: number): Promise<Buffer> {
  return sharp(frame)
    .resize(tileSizePx, tileSizePx, { fit: "cover" })
    .jpeg({ quality: 80 })
    .toBuffer();
}
