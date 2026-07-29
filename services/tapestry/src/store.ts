/**
 * In-memory frame store for the tapestry service.
 *
 * One latest 100px tile per opaque participant identity, per seeded session.
 * Frames expire after a fixed TTL and sessions cap the number of distinct
 * identities. Nothing in here ever touches disk; a process restart is an
 * empty tapestry by construction.
 */

export interface StoredParticipant {
  /** Ready-to-composite square tile (JPEG bytes), produced at ingest time. */
  tile: Buffer;
  /** First time this identity was ever seen in the session; fixes grid order. */
  firstSeenMs: number;
  /** Last successful ingest; frames older than the TTL are swept. */
  lastSeenMs: number;
}

export type IngestResult =
  | { ok: true; replaced: boolean }
  | { ok: false; reason: "unknown_session" | "session_full" };

export class TapestryStore {
  private readonly sessions = new Map<string, Map<string, StoredParticipant>>();

  constructor(
    sessionIds: readonly string[],
    private readonly maxParticipantsPerSession: number,
  ) {
    for (const id of sessionIds) {
      this.sessions.set(id, new Map());
    }
  }

  /**
   * Store (or replace) the tile for a participant. `firstSeenMs` is preserved
   * across replacements so grid ordering is deterministic by first appearance.
   * A new identity is admitted only while the session is below its cap.
   */
  ingest(sessionId: string, participantId: string, tile: Buffer, nowMs: number): IngestResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, reason: "unknown_session" };
    }
    const existing = session.get(participantId);
    if (!existing && session.size >= this.maxParticipantsPerSession) {
      return { ok: false, reason: "session_full" };
    }
    session.set(participantId, {
      tile,
      firstSeenMs: existing?.firstSeenMs ?? nowMs,
      lastSeenMs: nowMs,
    });
    return { ok: true, replaced: existing !== undefined };
  }

  /** Remove every frame older than the TTL. Returns how many were dropped. */
  sweepExpired(nowMs: number, ttlMs: number): number {
    return this.sweepExpiredDetailed(nowMs, ttlMs).size;
  }

  /** Like {@link sweepExpired} but returns the IDs of sessions that changed. */
  sweepExpiredDetailed(nowMs: number, ttlMs: number): Set<string> {
    const changed = new Set<string>();
    for (const [sessionId, session] of this.sessions) {
      for (const [participantId, participant] of session) {
        if (nowMs - participant.lastSeenMs > ttlMs) {
          session.delete(participantId);
          changed.add(sessionId);
        }
      }
    }
    return changed;
  }

  /**
   * Active participants of a session in deterministic grid order
   * (first-seen ascending, ties broken by nothing — first-seen is unique
   * per admission because order of insertion decides it).
   */
  activeParticipants(sessionId: string, nowMs: number, ttlMs: number): StoredParticipant[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }
    return [...session.values()]
      .filter((p) => nowMs - p.lastSeenMs <= ttlMs)
      .sort((a, b) => a.firstSeenMs - b.firstSeenMs);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  participantCount(): number {
    let total = 0;
    for (const session of this.sessions.values()) {
      total += session.size;
    }
    return total;
  }

  sessionCount(): number {
    return this.sessions.size;
  }
}
