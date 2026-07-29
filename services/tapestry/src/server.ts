/**
 * Internal HTTP surface of the tapestry service.
 *
 *   POST /tapestry/sessions/:sessionId/participants/:participantId/frame
 *        Authenticated JPEG ingest (raw image/jpeg body, size-capped).
 *   GET  /tapestry/sessions/:sessionId/composite.jpg
 *        Authenticated composite JPEG.
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
    const jpeg = await compositor.composite(sessionId);
    if (!jpeg) {
      sendJson(res, 404, { error: "unknown_session" });
      return;
    }
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "content-length": jpeg.length,
      // Downstream caching policy (2s shared TTL, staff-only variant) is set
      // by the Next.js proxy; the internal service itself asks not to be cached.
      "cache-control": "no-store",
    });
    res.end(jpeg);
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

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://tapestry.internal");
      const frameMatch = url.pathname.match(FRAME_ROUTE);
      const compositeMatch = url.pathname.match(COMPOSITE_ROUTE);

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
