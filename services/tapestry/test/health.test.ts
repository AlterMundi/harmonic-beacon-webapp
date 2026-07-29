/**
 * Health endpoint acceptance tests: reports service state and counts, and
 * never leaks session or participant identifiers.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { SESSION_A, SESSION_B, makeJpeg, postFrame, startService, testConfig } from "./helpers.js";

test("health reports state and counts without authentication", async () => {
  const service = await startService(testConfig());
  try {
    await postFrame(service.baseUrl, SESSION_A, "participant-x", await makeJpeg(255, 0, 0));
    await postFrame(service.baseUrl, SESSION_B, "participant-y", await makeJpeg(0, 255, 0));

    const res = await fetch(`${service.baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;

    assert.equal(body.service, "tapestry");
    assert.equal(body.status, "ok");
    assert.equal(body.sessionCount, 2);
    assert.equal(body.participantCount, 2);
    assert.equal(typeof body.compositesBuilt, "number");
    assert.equal(typeof body.uptimeSeconds, "number");
    assert.equal(typeof body.memoryRssBytes, "number");
    assert.deepEqual(body.grid, { width: 1500, height: 1000 });
  } finally {
    await service.close();
  }
});

test("health never exposes session or participant identifiers", async () => {
  const service = await startService(testConfig());
  try {
    await postFrame(service.baseUrl, SESSION_A, "participant-secret-name", await makeJpeg(255, 0, 0));

    const res = await fetch(`${service.baseUrl}/health`);
    const raw = await res.text();
    for (const identifier of [SESSION_A, SESSION_B, "participant-secret-name"]) {
      assert.ok(!raw.includes(identifier), `health output must not contain "${identifier}"`);
    }
  } finally {
    await service.close();
  }
});

test("unknown routes and methods return 404", async () => {
  const service = await startService(testConfig());
  try {
    assert.equal((await fetch(`${service.baseUrl}/nope`)).status, 404);
    assert.equal((await fetch(`${service.baseUrl}/health`, { method: "POST" })).status, 404);
    assert.equal(
      (await fetch(`${service.baseUrl}/tapestry/sessions/${SESSION_A}/composite.jpg`, {
        method: "DELETE",
      })).status,
      404,
    );
  } finally {
    await service.close();
  }
});
