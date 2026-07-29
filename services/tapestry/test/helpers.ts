/** Shared helpers for the tapestry service tests. */

import type { AddressInfo } from "node:net";

import sharp from "sharp";

import { DEFAULTS, type TapestryConfig } from "../src/config.js";
import { createTapestryServer, INTERNAL_SECRET_HEADER } from "../src/server.js";

export const TEST_SECRET = "test-secret-0123456789abcdef";
export const SESSION_A = "session-a";
export const SESSION_B = "session-b";

export function testConfig(overrides: Partial<TapestryConfig> = {}): TapestryConfig {
  return {
    port: 0, // ephemeral
    host: "127.0.0.1",
    internalSecret: TEST_SECRET,
    sessionIds: [SESSION_A, SESSION_B],
    maxFrameBytes: DEFAULTS.maxFrameBytes,
    frameTtlMs: DEFAULTS.frameTtlMs,
    maxParticipantsPerSession: DEFAULTS.maxParticipantsPerSession,
    tileSizePx: DEFAULTS.tileSizePx,
    gridColumns: DEFAULTS.gridColumns,
    compositeMinIntervalMs: DEFAULTS.compositeMinIntervalMs,
    sweepIntervalMs: DEFAULTS.sweepIntervalMs,
    compositeJpegQuality: DEFAULTS.compositeJpegQuality,
    ...overrides,
  };
}

export interface RunningService {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startService(config: TapestryConfig): Promise<RunningService> {
  const { server, close } = createTapestryServer(config);
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, close };
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { [INTERNAL_SECRET_HEADER]: TEST_SECRET, ...extra };
}

/** POST a frame for a participant. */
export function postFrame(
  baseUrl: string,
  sessionId: string,
  participantId: string,
  body: Buffer,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/tapestry/sessions/${sessionId}/participants/${participantId}/frame`, {
    method: "POST",
    headers: authHeaders({ "content-type": "image/jpeg", ...headers }),
    body: new Uint8Array(body),
  });
}

export function getComposite(
  baseUrl: string,
  sessionId: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/tapestry/sessions/${sessionId}/composite.jpg`, {
    headers: authHeaders(headers),
  });
}

/** A solid-color JPEG frame, like a tiny camera snapshot. */
export function makeJpeg(r: number, g: number, b: number, sizePx = 200): Promise<Buffer> {
  return sharp({
    create: { width: sizePx, height: sizePx, channels: 3, background: { r, g, b } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** Dominant channel check: is the given tile region of this JPEG roughly the color (r,g,b)? */
export async function tileColor(
  jpeg: Buffer,
  left: number,
  top: number,
  tilePx = 100,
): Promise<{ r: number; g: number; b: number }> {
  // Note: extract().stats() in one pipeline ignores the extract (sharp quirk),
  // so crop to a buffer first and measure that.
  const region = await sharp(jpeg)
    .extract({ left, top, width: tilePx, height: tilePx })
    .png()
    .toBuffer();
  const stats = await sharp(region).stats();
  return {
    r: stats.channels[0].mean,
    g: stats.channels[1].mean,
    b: stats.channels[2].mean,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
