/**
 * Soak acceptance test — SHORTENED.
 *
 * The acceptance criterion is a 60-ingest-request/second, 150-participant,
 * TEN-MINUTE run inside the container's defined limits (256 MB / 0.5 CPU,
 * see docker-compose.yml). Running ten minutes in the unit suite is
 * impractical, so this runs the same ingest rate and participant count for
 * 30 seconds in-process and asserts the things that degrade over time:
 * unbounded memory growth, ingest failures, and composite validity. The
 * full-length container soak runs at deployment/rehearsal time (WS5) with:
 *
 *   TAPESTRY_SOAK_SECONDS=600 MALLOC_ARENA_MAX=2 npx tsx --test test/soak.test.ts
 *
 * (MALLOC_ARENA_MAX mirrors the Dockerfile; without it glibc arenas hoard
 * libvips allocations and RSS grows even though the JS heap is flat.)
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import sharp from "sharp";

import { SESSION_A, getComposite, makeJpeg, postFrame, startService, testConfig, sleep } from "./helpers.js";

const SOAK_SECONDS = Number.parseInt(process.env.TAPESTRY_SOAK_SECONDS ?? "30", 10);
const INGESTS_PER_SECOND = 60;
const PARTICIPANTS = 150;

test(
  `soak: ${INGESTS_PER_SECOND} ingests/s across ${PARTICIPANTS} participants for ${SOAK_SECONDS}s`,
  { timeout: SOAK_SECONDS * 1000 + 60_000 },
  async () => {
    const service = await startService(testConfig());
    try {
      // One representative frame per participant (~real snapshot size).
      const frames: Buffer[] = [];
      for (let i = 0; i < PARTICIPANTS; i += 1) {
        frames.push(await makeJpeg((i * 37) % 256, (i * 91) % 256, (i * 53) % 256));
      }

      // Warm-up: admit all 150 participants and build the first composite.
      for (let i = 0; i < PARTICIPANTS; i += 1) {
        const res = await postFrame(service.baseUrl, SESSION_A, `soak-p${i}`, frames[i]);
        assert.equal(res.status, 201);
      }
      await getComposite(service.baseUrl, SESSION_A);
      const rssBefore = process.memoryUsage().rss;

      let ingestsSent = 0;
      let ingestsFailed = 0;
      let compositesFetched = 0;
      let nextParticipant = 0;

      const startedAt = Date.now();
      const ingestTicker = setInterval(() => {
        // 6 ingests every 100ms = 60/second, round-robin over participants.
        for (let n = 0; n < INGESTS_PER_SECOND / 10; n += 1) {
          const index = nextParticipant % PARTICIPANTS;
          nextParticipant += 1;
          ingestsSent += 1;
          void postFrame(service.baseUrl, SESSION_A, `soak-p${index}`, frames[index]).then(
            async (res) => {
              await res.arrayBuffer(); // drain the body so undici releases it
              if (res.status !== 200) {
                ingestsFailed += 1;
              }
            },
          );
        }
      }, 100);

      const compositeTicker = setInterval(() => {
        void getComposite(service.baseUrl, SESSION_A).then(async (res) => {
          if (res.status === 200) {
            await res.arrayBuffer(); // consume the JPEG like a real proxy would
            compositesFetched += 1;
          }
        });
      }, 2_000);

      while (Date.now() - startedAt < SOAK_SECONDS * 1000) {
        await sleep(500);
      }
      clearInterval(ingestTicker);
      clearInterval(compositeTicker);
      await sleep(2_000); // let in-flight requests settle

      const rssAfter = process.memoryUsage().rss;
      const rssGrowthMb = (rssAfter - rssBefore) / (1024 * 1024);

      assert.equal(ingestsFailed, 0, `${ingestsFailed}/${ingestsSent} ingests failed`);
      assert.ok(
        ingestsSent >= SOAK_SECONDS * INGESTS_PER_SECOND * 0.9,
        `expected ~${SOAK_SECONDS * INGESTS_PER_SECOND} ingests, sent ${ingestsSent}`,
      );

      const health = (await (await fetch(`${service.baseUrl}/health`)).json()) as {
        participantCount: number;
        memoryRssBytes: number;
      };
      assert.equal(health.participantCount, PARTICIPANTS, "all participants still fresh");

      // Memory stays bounded: tiles are ~3 MB total, so after warm-up RSS
      // must plateau, not grow per request. The limit below catches an
      // unbounded leak (without MALLOC_ARENA_MAX=2 this grows >350 MB in
      // 30s) while tolerating allocator ramp-up in the tsx test process;
      // the container's hard ceiling is enforced by mem_limit=256m on the
      // much smaller production process.
      assert.ok(
        rssGrowthMb < 150,
        `RSS grew ${rssGrowthMb.toFixed(1)} MB during the soak (limit 150 MB growth after warm-up)`,
      );

      // The composite is still a valid JPEG of the full grid.
      const res = await getComposite(service.baseUrl, SESSION_A);
      assert.equal(res.status, 200);
      const jpeg = Buffer.from(await res.arrayBuffer());
      const metadata = await sharp(jpeg).metadata();
      assert.equal(metadata.format, "jpeg");
      assert.equal(metadata.width, 1500);
      assert.equal(metadata.height, 1000);

      console.log(
        `[tapestry soak] ${ingestsSent} ingests (${ingestsFailed} failed), ` +
          `${compositesFetched} composites, RSS growth ${rssGrowthMb.toFixed(1)} MB`,
      );
    } finally {
      await service.close();
    }
  },
);
