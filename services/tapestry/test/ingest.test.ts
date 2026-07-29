/**
 * Ingest acceptance tests: every rejection path drops the request without
 * retaining bytes, replacement works, and the 150-identity cap holds.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SESSION_A,
  TEST_SECRET,
  authHeaders,
  getComposite,
  makeJpeg,
  postFrame,
  startService,
  testConfig,
  tileColor,
} from "./helpers.js";

async function participantCount(baseUrl: string): Promise<number> {
  const res = await fetch(`${baseUrl}/health`);
  const body = (await res.json()) as { participantCount: number };
  return body.participantCount;
}

test("rejects a bad internal secret on ingest without retaining bytes", async () => {
  const service = await startService(testConfig());
  try {
    const frame = await makeJpeg(255, 0, 0);
    const url = `${service.baseUrl}/tapestry/sessions/${SESSION_A}/participants/p1/frame`;

    // Missing header entirely.
    const missing = await fetch(url, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: new Uint8Array(frame),
    });
    assert.equal(missing.status, 401);

    // Wrong secret value.
    const wrong = await postFrame(service.baseUrl, SESSION_A, "p1", frame, {
      "x-tapestry-internal-secret": "wrong-secret-wrong-secret",
    });
    assert.equal(wrong.status, 401);

    assert.equal(await participantCount(service.baseUrl), 0);
  } finally {
    await service.close();
  }
});

test("rejects a bad internal secret on composite", async () => {
  const service = await startService(testConfig());
  try {
    const res = await getComposite(service.baseUrl, SESSION_A, {
      "x-tapestry-internal-secret": "wrong-secret-wrong-secret",
    });
    assert.equal(res.status, 401);
  } finally {
    await service.close();
  }
});

test("rejects a non-JPEG content type without retaining bytes", async () => {
  const service = await startService(testConfig());
  try {
    const frame = await makeJpeg(255, 0, 0);
    const res = await postFrame(service.baseUrl, SESSION_A, "p1", frame, {
      "content-type": "image/png",
    });
    assert.equal(res.status, 415);
    assert.equal(await participantCount(service.baseUrl), 0);
  } finally {
    await service.close();
  }
});

test("rejects an oversized body without retaining bytes", async () => {
  const service = await startService(testConfig());
  try {
    const oversized = Buffer.alloc(21 * 1024, 0xff); // cap is 20 KB
    const res = await postFrame(service.baseUrl, SESSION_A, "p1", oversized);
    assert.equal(res.status, 413);
    assert.equal(await participantCount(service.baseUrl), 0);
  } finally {
    await service.close();
  }
});

test("rejects undecodable JPEG bytes without retaining bytes", async () => {
  const service = await startService(testConfig());
  try {
    const garbage = Buffer.alloc(1024, 0x42);
    const res = await postFrame(service.baseUrl, SESSION_A, "p1", garbage);
    assert.equal(res.status, 422);
    assert.equal(await participantCount(service.baseUrl), 0);
  } finally {
    await service.close();
  }
});

test("rejects an unknown session without retaining bytes", async () => {
  const service = await startService(testConfig());
  try {
    const frame = await makeJpeg(255, 0, 0);
    const res = await postFrame(service.baseUrl, "not-a-seeded-session", "p1", frame);
    assert.equal(res.status, 404);
    assert.equal(await participantCount(service.baseUrl), 0);
  } finally {
    await service.close();
  }
});

test("rejects the 151st identity while the 150 existing ones still update", async () => {
  const service = await startService(testConfig());
  try {
    const frame = await makeJpeg(0, 255, 0);
    for (let i = 0; i < 150; i += 1) {
      const res = await postFrame(service.baseUrl, SESSION_A, `p${i}`, frame);
      assert.equal(res.status, 201, `participant ${i} should be admitted`);
    }
    assert.equal(await participantCount(service.baseUrl), 150);

    const rejected = await postFrame(service.baseUrl, SESSION_A, "p150", frame);
    assert.equal(rejected.status, 429);
    assert.equal(await participantCount(service.baseUrl), 150);

    // An existing identity is a replacement, not a new admission.
    const replaced = await postFrame(service.baseUrl, SESSION_A, "p0", frame);
    assert.equal(replaced.status, 200);
    assert.equal(await participantCount(service.baseUrl), 150);
  } finally {
    await service.close();
  }
});

test("a new frame replaces the old frame for that identity", async () => {
  const service = await startService(testConfig());
  try {
    await postFrame(service.baseUrl, SESSION_A, "p1", await makeJpeg(255, 0, 0));
    await postFrame(service.baseUrl, SESSION_A, "p1", await makeJpeg(0, 0, 255));
    assert.equal(await participantCount(service.baseUrl), 1);

    const res = await getComposite(service.baseUrl, SESSION_A);
    assert.equal(res.status, 200);
    const jpeg = Buffer.from(await res.arrayBuffer());
    const color = await tileColor(jpeg, 0, 0);
    assert.ok(color.b > 150 && color.r < 80, `tile should be blue, got ${JSON.stringify(color)}`);
  } finally {
    await service.close();
  }
});

test("a frame at most 20 KB is accepted", async () => {
  const service = await startService(testConfig());
  try {
    // Noise compresses badly, so a noisy 128px JPEG lands close to the cap.
    const noise = Buffer.alloc(128 * 128 * 3);
    for (let i = 0; i < noise.length; i += 1) noise[i] = Math.floor(Math.random() * 256);
    const sharp = (await import("sharp")).default;
    const frame = await sharp(noise, { raw: { width: 128, height: 128, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();
    assert.ok(frame.length <= 20 * 1024, `test frame ${frame.length} bytes must fit the cap`);
    const res = await postFrame(service.baseUrl, SESSION_A, "p1", frame);
    assert.equal(res.status, 201);
  } finally {
    await service.close();
  }
});
