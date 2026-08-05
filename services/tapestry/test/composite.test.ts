/**
 * Composite acceptance tests: valid JPEG output, fixed 1500x1000 grid of
 * Composite acceptance tests: valid JPEG output, grid dynamically sized to
 * the active participant set (100px tiles in deterministic first-seen
 * order), at most one rebuild per second, and expiry of stale participants
 * within 12 seconds.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import sharp from "sharp";

import { TapestryCompositor } from "../src/composite.js";
import { TapestryStore } from "../src/store.js";

import {
  SESSION_A,
  getComposite,
  makeJpeg,
  postFrame,
  sleep,
  startService,
  testConfig,
  tileColor,
} from "./helpers.js";

async function compositesBuilt(baseUrl: string): Promise<number> {
  const res = await fetch(`${baseUrl}/health`);
  const body = (await res.json()) as { compositesBuilt: number };
  return body.compositesBuilt;
}

test("composite grid is sized to the active participants, not the cap", async () => {
  const service = await startService(testConfig());
  try {
    await postFrame(service.baseUrl, SESSION_A, "p1", await makeJpeg(255, 0, 0));
    const res = await getComposite(service.baseUrl, SESSION_A);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
    const jpeg = Buffer.from(await res.arrayBuffer());
    const metadata = await sharp(jpeg).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 100, "one participant is a single tile, not the 150-slot wall");
    assert.equal(metadata.height, 100);

    // A second arrival widens the strip; a third still fits in one row.
    await postFrame(service.baseUrl, SESSION_A, "p2", await makeJpeg(0, 255, 0));
    await postFrame(service.baseUrl, SESSION_A, "p3", await makeJpeg(0, 0, 255));
    await sleep(1100); // rebuild rate limit
    const res2 = await getComposite(service.baseUrl, SESSION_A);
    const meta2 = await sharp(Buffer.from(await res2.arrayBuffer())).metadata();
    assert.equal(meta2.width, 300);
    assert.equal(meta2.height, 100);
  } finally {
    await service.close();
  }
});

test("tiles land in deterministic first-seen order, 100px each, no trailing empty grid", async () => {
  const service = await startService(testConfig());
  try {
    // Deliberately ingest "zz" before "aa": grid order is by arrival, not name.
    await postFrame(service.baseUrl, SESSION_A, "zz", await makeJpeg(255, 0, 0)); // red first
    await postFrame(service.baseUrl, SESSION_A, "aa", await makeJpeg(0, 0, 255)); // blue second
    await postFrame(service.baseUrl, SESSION_A, "mm", await makeJpeg(0, 220, 0)); // green third

    const res = await getComposite(service.baseUrl, SESSION_A);
    const jpeg = Buffer.from(await res.arrayBuffer());
    const metadata = await sharp(jpeg).metadata();
    assert.equal(metadata.width, 300, "three participants fill exactly three tiles");
    assert.equal(metadata.height, 100);

    const first = await tileColor(jpeg, 0, 0);
    const second = await tileColor(jpeg, 100, 0);
    const third = await tileColor(jpeg, 200, 0);

    assert.ok(first.r > 150 && first.b < 80, `tile 0 should be red, got ${JSON.stringify(first)}`);
    assert.ok(second.b > 150 && second.r < 80, `tile 1 should be blue, got ${JSON.stringify(second)}`);
    assert.ok(third.g > 120 && third.r < 80, `tile 2 should be green, got ${JSON.stringify(third)}`);
  } finally {
    await service.close();
  }
});

test("composite rebuilds at most once per second and only when frames changed", async () => {
  const service = await startService(testConfig());
  try {
    await postFrame(service.baseUrl, SESSION_A, "p1", await makeJpeg(255, 0, 0));

    assert.equal(await compositesBuilt(service.baseUrl), 0);
    await getComposite(service.baseUrl, SESSION_A);
    await getComposite(service.baseUrl, SESSION_A);
    await getComposite(service.baseUrl, SESSION_A);
    assert.equal(await compositesBuilt(service.baseUrl), 1, "rapid repeats serve the cache");

    // Time passes but nothing changed: still the cached image.
    await sleep(1100);
    await getComposite(service.baseUrl, SESSION_A);
    assert.equal(await compositesBuilt(service.baseUrl), 1);

    // A new frame marks the composite dirty; after the interval it rebuilds once.
    await postFrame(service.baseUrl, SESSION_A, "p1", await makeJpeg(0, 0, 255));
    await sleep(1100);
    await getComposite(service.baseUrl, SESSION_A);
    assert.equal(await compositesBuilt(service.baseUrl), 2);
  } finally {
    await service.close();
  }
});

test("a frame ingested during an in-flight build remains dirty for the next bounded rebuild", async () => {
  let now = 1_000;
  const config = testConfig({ compositeMinIntervalMs: 1_000 });
  const store = new TapestryStore(config.sessionIds, config.maxParticipantsPerSession);
  const compositor = new TapestryCompositor(config, store, () => now);
  const red = await makeJpeg(255, 0, 0, config.tileSizePx);
  const blue = await makeJpeg(0, 0, 255, config.tileSizePx);

  store.ingest(SESSION_A, "p1", red, now);
  compositor.markDirty(SESSION_A);
  const firstBuild = compositor.composite(SESSION_A);
  const concurrentCaller = compositor.composite(SESSION_A);

  // `build()` has already captured the red tile, but libvips is still
  // encoding asynchronously. This ingest must survive completion bookkeeping.
  store.ingest(SESSION_A, "p1", blue, now);
  compositor.markDirty(SESSION_A);

  const [first, concurrent] = await Promise.all([firstBuild, concurrentCaller]);
  assert.ok(first);
  assert.strictEqual(concurrent, first, "concurrent callers share one completed snapshot");
  assert.equal(compositor.compositesBuiltCount(), 1);
  const firstColor = await tileColor(first.bytes, 0, 0);
  assert.ok(firstColor.r > 150 && firstColor.b < 80, "the in-flight snapshot stays coherent");

  const rateLimited = await compositor.composite(SESSION_A);
  assert.strictEqual(rateLimited, first, "ordinary ingest still respects the rebuild interval");
  assert.equal(compositor.compositesBuiltCount(), 1);

  now += config.compositeMinIntervalMs;
  const rebuilt = await compositor.composite(SESSION_A);
  assert.ok(rebuilt);
  assert.equal(compositor.compositesBuiltCount(), 2, "the intervening ingest triggers a later build");
  const rebuiltColor = await tileColor(rebuilt.bytes, 0, 0);
  assert.ok(rebuiltColor.b > 150 && rebuiltColor.r < 80, "the newest frame becomes visible");
});

test("a stale participant disappears from the composite within 12 seconds", async () => {
  // Real production timing: 10s TTL, 500ms sweep. This test takes ~11s.
  const service = await startService(testConfig());
  try {
    await postFrame(service.baseUrl, SESSION_A, "p1", await makeJpeg(255, 0, 0));
    const before = await getComposite(service.baseUrl, SESSION_A);
    const beforeColor = await tileColor(Buffer.from(await before.arrayBuffer()), 0, 0);
    assert.ok(beforeColor.r > 150, "participant visible right after ingest");

    await sleep(11_000); // TTL 10s + up to two sweep intervals

    const res = await fetch(`${service.baseUrl}/health`);
    const health = (await res.json()) as { participantCount: number };
    assert.equal(health.participantCount, 0, "stale frame swept within 12 seconds");

    const after = await getComposite(service.baseUrl, SESSION_A);
    const afterColor = await tileColor(Buffer.from(await after.arrayBuffer()), 0, 0);
    assert.ok(
      Math.abs(afterColor.r - 17) < 8,
      `tile 0 should be background again, got ${JSON.stringify(afterColor)}`,
    );
  } finally {
    await service.close();
  }
});

test("a fresh frame keeps a participant alive across sweeps", async () => {
  const service = await startService(testConfig({ frameTtlMs: 800, sweepIntervalMs: 100 }));
  try {
    await postFrame(service.baseUrl, SESSION_A, "p1", await makeJpeg(255, 0, 0));
    for (let i = 0; i < 5; i += 1) {
      await sleep(400);
      await postFrame(service.baseUrl, SESSION_A, "p1", await makeJpeg(255, 0, 0));
    }
    const res = await fetch(`${service.baseUrl}/health`);
    const health = (await res.json()) as { participantCount: number };
    assert.equal(health.participantCount, 1, "regular ingest keeps the frame alive");
  } finally {
    await service.close();
  }
});

test("a fresh service instance is an empty tapestry (restart semantics)", async () => {
  const config = testConfig();
  const first = await startService(config);
  try {
    await postFrame(first.baseUrl, SESSION_A, "p1", await makeJpeg(255, 0, 0));
    const health = (await (await fetch(`${first.baseUrl}/health`)).json()) as {
      participantCount: number;
    };
    assert.equal(health.participantCount, 1);
  } finally {
    await first.close();
  }

  // A new process holds no frames; the composite is the empty background grid.
  const second = await startService(config);
  try {
    const health = (await (await fetch(`${second.baseUrl}/health`)).json()) as {
      participantCount: number;
      compositesBuilt: number;
    };
    assert.equal(health.participantCount, 0);
    const res = await getComposite(second.baseUrl, SESSION_A);
    assert.equal(res.status, 200);
    const color = await tileColor(Buffer.from(await res.arrayBuffer()), 0, 0);
    assert.ok(Math.abs(color.r - 17) < 8, "composite after restart is the empty grid");
  } finally {
    await second.close();
  }
});
