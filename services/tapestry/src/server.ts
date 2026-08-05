/**
 * Internal HTTP surface of the tapestry service.
 *
 *   POST /tapestry/sessions/:sessionId/participants/:participantId/frame
 *        Authenticated JPEG ingest (raw image/jpeg body, size-capped).
 *   GET  /tapestry/sessions/:sessionId/composite.jpg
 *        Authenticated composite JPEG, with the build revision in
 *        `x-tapestry-revision` so overlays can match their layout to it.
 *   GET  /tapestry/sessions/:sessionId/participants
 *        Authenticated list of active participant ids in display order.
 *   GET  /tapestry/sessions/:sessionId/layout
 *        Authenticated grid layout (revision, columns, rows, tile size and
 *        per-tile cells) captured by the same build as the served composite.
 *   PUT  /tapestry/sessions/:sessionId/order
 *        Authenticated staff arrangement: JSON {"order": string[]}.
 *   GET  /tapestry/sessions/:sessionId/participants/:participantId/frame.jpg
 *        Authenticated single tile JPEG (for the ops arrange UI).
 *   GET  /health
 *        Unauthenticated liveness/state: counts only, never identifiers.
 *
 * The service binds to an internal port; the shared-secret header is the
 * boundary between this process and the Next.js app that proxies for it.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { isValidOpaqueId, type TapestryConfig } from "./config.js";
import { TapestryStore } from "./store.js";
import { TapestryCompositor, frameToTile } from "./composite.js";

export const INTERNAL_SECRET_HEADER = "x-tapestry-internal-secret";

const FRAME_ROUTE =
  /^\/tapestry\/sessions\/([A-Za-z0-9_-]{1,128})\/participants\/([A-Za-z0-9_-]{1,128})\/frame$/;
const COMPOSITE_ROUTE = /^\/tapestry\/sessions\/([A-Za-z0-9_-]{1,128})\/composite\.jpg$/;
const PARTICIPANTS_ROUTE = /^\/tapestry\/sessions\/([A-Za-z0-9_-]{1,128})\/participants$/;
const LAYOUT_ROUTE = /^\/tapestry\/sessions\/([A-Za-z0-9_-]{1,128})\/layout$/;
const ORDER_ROUTE = /^\/tapestry\/sessions\/([A-Za-z0-9_-]{1,128})\/order$/;
const TILE_ROUTE =
  /^\/tapestry\/sessions\/([A-Za-z0-9_-]{1,128})\/participants\/([A-Za-z0-9_-]{1,128})\/frame\.jpg$/;

export interface TapestryServer {
  server: Server;
  store: TapestryStore;
  compositor: TapestryCompositor;
  close: () => Promise<void>;
}

class BodyTooLargeError extends Error {}

/** Read a request body, rejecting the moment it exceeds the cap. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) {
        return; // drain and discard; the 413 response is already on its way
      }
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", (error) => {
      if (!tooLarge) {
        reject(error);
      }
    });
  });
}

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

export function createTapestryServer(config: TapestryConfig): TapestryServer {
  const store = new TapestryStore(config.sessionIds, config.maxParticipantsPerSession);
  const compositor = new TapestryCompositor(config, store);
  const startedAtMs = Date.now();

  const sweeper = setInterval(() => {
    const now = Date.now();
    // Flag exactly the sessions whose frame set changed so their next
    // composite rebuilds instead of serving a stale grid.
    const changed = store.sweepExpiredDetailed(now, config.frameTtlMs);
    for (const sessionId of changed) {
      compositor.markDirty(sessionId);
    }
  }, config.sweepIntervalMs);
  sweeper.unref();

  async function handleIngest(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
    participantId: string,
  ): Promise<void> {
    if (!secretMatches(req.headers[INTERNAL_SECRET_HEADER] as string | undefined, config.internalSecret)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (req.headers["content-type"] !== "image/jpeg") {
      sendJson(res, 415, { error: "content_type_must_be_image_jpeg" });
      return;
    }
    if (!store.hasSession(sessionId)) {
      sendJson(res, 404, { error: "unknown_session" });
      return;
    }

    let body: Buffer;
    try {
      body = await readBody(req, config.maxFrameBytes);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(res, 413, { error: "frame_too_large" });
        return;
      }
      throw error;
    }
    if (body.length === 0) {
      sendJson(res, 400, { error: "empty_frame" });
      return;
    }

    // Decode + normalize before admitting anything to the store: undecodable
    // bytes are rejected here and never retained.
    let tile: Buffer;
    try {
      tile = await frameToTile(body, config.tileSizePx);
    } catch {
      sendJson(res, 422, { error: "undecodable_jpeg" });
      return;
    }
    body = Buffer.alloc(0);

    const result = store.ingest(sessionId, participantId, tile, Date.now());
    if (!result.ok) {
      sendJson(res, result.reason === "session_full" ? 429 : 404, { error: result.reason });
      return;
    }
    compositor.markDirty(sessionId);
    sendJson(res, result.replaced ? 200 : 201, { ok: true, replaced: result.replaced });
  }

  async function handleComposite(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
  ): Promise<void> {
    if (!secretMatches(req.headers[INTERNAL_SECRET_HEADER] as string | undefined, config.internalSecret)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    // One immutable snapshot per response: bytes, revision and layout all
    // belong to the same completed build, even if a newer build finishes
    // while this response is in flight.
    const snapshot = await compositor.composite(sessionId);
    if (!snapshot) {
      sendJson(res, 404, { error: "unknown_session" });
      return;
    }
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "content-length": snapshot.bytes.length,
      // Downstream caching policy (2s shared TTL, staff-only variant) is set
      // by the Next.js proxy; the internal service itself asks not to be cached.
      "cache-control": "no-store",
      // Names the exact build these bytes came from; overlay consumers must
      // only draw over a composite whose revision matches their layout.
      "x-tapestry-revision": String(snapshot.revision),
    });
    res.end(snapshot.bytes);
  }

  async function handleLayout(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
  ): Promise<void> {
    if (!secretMatches(req.headers[INTERNAL_SECRET_HEADER] as string | undefined, config.internalSecret)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (!store.hasSession(sessionId)) {
      sendJson(res, 404, { error: "unknown_session" });
      return;
    }
    const layout = compositor.builtCompositeLayout(sessionId);
    const revision = compositor.builtRevisionOf(sessionId);
    if (!layout || revision === null) {
      // No composite has been built yet: there is truthfully nothing to overlay.
      sendJson(res, 404, { error: "layout_unavailable" });
      return;
    }
    // frameTtlMs rides along so consumers can state snapshot freshness
    // without a second internal endpoint.
    sendJson(res, 200, { revision, frameTtlMs: config.frameTtlMs, ...layout });
  }

  function handleHealth(res: ServerResponse): void {
    // Counts only — session and participant identifiers never leave this endpoint.
    sendJson(res, 200, {
      service: "tapestry",
      status: "ok",
      uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
      sessionCount: store.sessionCount(),
      participantCount: store.participantCount(),
      compositesBuilt: compositor.compositesBuiltCount(),
      grid: compositor.gridDimensionsPx(),
      memoryRssBytes: process.memoryUsage().rss,
    });
  }

  async function handleParticipants(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
  ): Promise<void> {
    if (!secretMatches(req.headers[INTERNAL_SECRET_HEADER] as string | undefined, config.internalSecret)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (!store.hasSession(sessionId)) {
      sendJson(res, 404, { error: "unknown_session" });
      return;
    }
    const ids = store
      .orderedActive(sessionId, Date.now(), config.frameTtlMs)
      .map(({ id }) => id);
    sendJson(res, 200, {
      participants: ids,
      // Consumers can communicate freshness truthfully without learning
      // per-participant timestamps. Existing clients ignore this additive field.
      frameTtlMs: config.frameTtlMs,
    });
  }

  async function handleOrder(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
  ): Promise<void> {
    if (!secretMatches(req.headers[INTERNAL_SECRET_HEADER] as string | undefined, config.internalSecret)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (!store.hasSession(sessionId)) {
      sendJson(res, 404, { error: "unknown_session" });
      return;
    }
    let body: Buffer;
    try {
      body = await readBody(req, 64 * 1024);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(res, 413, { error: "body_too_large" });
        return;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      sendJson(res, 400, { error: "invalid_json" });
      return;
    }
    const order = (parsed as { order?: unknown }).order;
    if (
      !Array.isArray(order) ||
      order.some((id) => typeof id !== "string" || !isValidOpaqueId(id)) ||
      new Set(order).size !== order.length
    ) {
      sendJson(res, 400, { error: "invalid_order" });
      return;
    }
    store.setOrder(sessionId, order as string[]);
    compositor.markDirty(sessionId, true);
    sendJson(res, 200, { ok: true, stored: (order as string[]).length });
  }

  async function handleTile(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
    participantId: string,
  ): Promise<void> {
    if (!secretMatches(req.headers[INTERNAL_SECRET_HEADER] as string | undefined, config.internalSecret)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const entry = store
      .orderedActive(sessionId, Date.now(), config.frameTtlMs)
      .find(({ id }) => id === participantId);
    if (!entry) {
      sendJson(res, 404, { error: "unknown_participant" });
      return;
    }
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "content-length": entry.participant.tile.length,
      "cache-control": "no-store",
    });
    res.end(entry.participant.tile);
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://tapestry.internal");
      const frameMatch = url.pathname.match(FRAME_ROUTE);
      const compositeMatch = url.pathname.match(COMPOSITE_ROUTE);
      const participantsMatch = url.pathname.match(PARTICIPANTS_ROUTE);
      const orderMatch = url.pathname.match(ORDER_ROUTE);
      const tileMatch = url.pathname.match(TILE_ROUTE);

      if (req.method === "POST" && frameMatch) {
        const [, sessionId, participantId] = frameMatch;
        if (!isValidOpaqueId(sessionId) || !isValidOpaqueId(participantId)) {
          sendJson(res, 400, { error: "invalid_id" });
          return;
        }
        await handleIngest(req, res, sessionId, participantId);
        return;
      }
      if (req.method === "GET" && compositeMatch) {
        await handleComposite(req, res, compositeMatch[1]);
        return;
      }
      if (req.method === "GET" && participantsMatch) {
        await handleParticipants(req, res, participantsMatch[1]);
        return;
      }
      const layoutMatch = url.pathname.match(LAYOUT_ROUTE);
      if (req.method === "GET" && layoutMatch) {
        await handleLayout(req, res, layoutMatch[1]);
        return;
      }
      if (req.method === "PUT" && orderMatch) {
        await handleOrder(req, res, orderMatch[1]);
        return;
      }
      if (req.method === "GET" && tileMatch) {
        const [, sessionId, participantId] = tileMatch;
        if (!isValidOpaqueId(sessionId) || !isValidOpaqueId(participantId)) {
          sendJson(res, 400, { error: "invalid_id" });
          return;
        }
        await handleTile(req, res, sessionId, participantId);
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        handleHealth(res);
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    })().catch((error: unknown) => {
      console.error("[tapestry] unhandled request error:", error instanceof Error ? error.message : error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal_error" });
      }
      res.end();
    });
  });

  return {
    server,
    store,
    compositor,
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(sweeper);
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
