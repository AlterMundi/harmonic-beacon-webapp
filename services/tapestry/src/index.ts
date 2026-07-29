/**
 * Tapestry service entrypoint.
 *
 * Bounded in-memory composite of attendee camera snapshots: the Next.js app
 * POSTs one small JPEG per participant (through an entitlement-gated proxy),
 * this process keeps only the latest 100px tile per opaque identity, expires
 * frames after ten seconds, and renders one grid JPEG per seeded session at
 * most once per second. Nothing is written to disk.
 */

import { configFromEnv } from "./config.js";
import { createTapestryServer } from "./server.js";

const config = configFromEnv();
const { server } = createTapestryServer(config);

server.listen(config.port, config.host, () => {
  console.log(
    `[tapestry] listening on ${config.host}:${config.port} ` +
      `(${config.sessionIds.length} seeded session(s), cap ${config.maxParticipantsPerSession}/session, ` +
      `frame TTL ${config.frameTtlMs}ms, max frame ${config.maxFrameBytes} bytes)`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[tapestry] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
