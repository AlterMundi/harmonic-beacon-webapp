import { createHash, timingSafeEqual } from 'node:crypto';

export const MEDIA_GRANT_ID_PATTERN = /^[a-f0-9]{64}$/;
export const MEDIA_GRANT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const MEDIA_GRANT_MAX_TTL_MS = 4 * 60 * 1000;
export const MEDIA_GRANT_MAX_ENTRIES = 20_000;

function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

export class MediaGrantRegistry {
  #entries = new Map();
  #now;
  #maxEntries;

  constructor({ now = () => Date.now(), maxEntries = MEDIA_GRANT_MAX_ENTRIES } = {}) {
    this.#now = now;
    this.#maxEntries = maxEntries;
  }

  pruneExpired(nowMs = this.#now()) {
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAtMs <= nowMs) this.#entries.delete(id);
    }
  }

  upsert({ id, tokenSha256, expiresAtMs }) {
    const nowMs = this.#now();
    this.pruneExpired(nowMs);
    if (!MEDIA_GRANT_ID_PATTERN.test(id)
      || !/^[a-f0-9]{64}$/.test(tokenSha256)
      || !Number.isSafeInteger(expiresAtMs)
      || expiresAtMs <= nowMs
      || expiresAtMs > nowMs + MEDIA_GRANT_MAX_TTL_MS) {
      return { ok: false, reason: 'invalid' };
    }
    const existing = this.#entries.get(id);
    if (existing && existing.tokenSha256 !== tokenSha256) {
      return { ok: false, reason: 'conflict' };
    }
    if (!existing && this.#entries.size >= this.#maxEntries) {
      return { ok: false, reason: 'capacity' };
    }
    this.#entries.set(id, {
      tokenSha256,
      expiresAtMs: Math.max(existing?.expiresAtMs ?? 0, expiresAtMs),
    });
    return { ok: true };
  }

  authorize({ id, token }) {
    if (!MEDIA_GRANT_ID_PATTERN.test(id) || !MEDIA_GRANT_TOKEN_PATTERN.test(token)) return false;
    const entry = this.#entries.get(id);
    if (!entry) return false;
    const nowMs = this.#now();
    if (entry.expiresAtMs <= nowMs) {
      this.#entries.delete(id);
      return false;
    }
    const supplied = tokenHash(token);
    const expected = Buffer.from(entry.tokenSha256, 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  get size() {
    this.pruneExpired();
    return this.#entries.size;
  }
}

