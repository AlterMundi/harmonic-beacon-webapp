/**
 * Staff arrangement tests: explicit display order is stored per session,
 * reflected in the participants listing and the composite, validated on
 * write, and individual tiles are addressable for the ops UI.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SESSION_A,
  authHeaders,
  getComposite,
  makeJpeg,
  postFrame,
  startService,
  testConfig,
  tileColor,
} from "./helpers.js";

async function putOrder(baseUrl: string, sessionId: string, order: unknown, extraHeaders: Record<string, string> = {}) {
  return fetch(`${baseUrl}/tapestry/sessions/${sessionId}/order`, {
    method: "PUT",
    headers: authHeaders({ "content-type": "application/json", ...extraHeaders }),
    body: JSON.stringify({ order }),
  });
}

test("explicit order rearranges the composite and the participants listing", async () => {
  const service = await startService(testConfig());
  try {
    await postFrame(service.baseUrl, SESSION_A, "p-red", await makeJpeg(255, 0, 0));
    await postFrame(service.baseUrl, SESSION_A, "p-green", await makeJpeg(0, 255, 0));

    // Default: first-seen — red at the left edge.
    let composite = await getComposite(service.baseUrl, SESSION_A);
    assert.equal(composite.status, 200);
    let color = await tileColor(Buffer.from(await composite.arrayBuffer()), 0, 0);
    assert.ok(color.r > 200 && color.g < 60, `expected red first, got ${JSON.stringify(color)}`);

    // Staff arrangement: green first.
    const put = await putOrder(service.baseUrl, SESSION_A, ["p-green", "p-red"]);
    assert.equal(put.status, 200);

    const list = await fetch(`${service.baseUrl}/tapestry/sessions/${SESSION_A}/participants`, {
      headers: authHeaders(),
    });
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json() as { participants: string[] }).participants, ["p-green", "p-red"]);

    composite = await getComposite(service.baseUrl, SESSION_A);
    color = await tileColor(Buffer.from(await composite.arrayBuffer()), 0, 0);
    assert.ok(color.g > 200 && color.r < 60, `expected green first, got ${JSON.stringify(color)}`);
  } finally {
    await service.close();
  }
});

test("order write is validated: auth, unknown session, malformed ids, duplicates", async () => {
  const service = await startService(testConfig());
  try {
    const noAuth = await fetch(`${service.baseUrl}/tapestry/sessions/${SESSION_A}/order`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: ["p1"] }),
    });
    assert.equal(noAuth.status, 401);

    assert.equal((await putOrder(service.baseUrl, "no-such-session", ["p1"])).status, 404);
    assert.equal((await putOrder(service.baseUrl, SESSION_A, "not-an-array")).status, 400);
    assert.equal((await putOrder(service.baseUrl, SESSION_A, ["bad id!"])).status, 400);
    assert.equal((await putOrder(service.baseUrl, SESSION_A, ["p1", "p1"])).status, 400);
    assert.equal((await putOrder(service.baseUrl, SESSION_A, [])).status, 200);
  } finally {
    await service.close();
  }
});

test("single tile endpoint serves the stored jpeg and 404s for strangers", async () => {
  const service = await startService(testConfig());
  try {
    await postFrame(service.baseUrl, SESSION_A, "p-red", await makeJpeg(255, 0, 0));

    const tile = await fetch(`${service.baseUrl}/tapestry/sessions/${SESSION_A}/participants/p-red/frame.jpg`, {
      headers: authHeaders(),
    });
    assert.equal(tile.status, 200);
    assert.equal(tile.headers.get("content-type"), "image/jpeg");
    const bytes = Buffer.from(await tile.arrayBuffer());
    const color = await tileColor(bytes, 0, 0);
    assert.ok(color.r > 200, `expected red tile, got ${JSON.stringify(color)}`);

    const stranger = await fetch(`${service.baseUrl}/tapestry/sessions/${SESSION_A}/participants/p-nope/frame.jpg`, {
      headers: authHeaders(),
    });
    assert.equal(stranger.status, 404);

    const noAuth = await fetch(`${service.baseUrl}/tapestry/sessions/${SESSION_A}/participants/p-red/frame.jpg`);
    assert.equal(noAuth.status, 401);
  } finally {
    await service.close();
  }
});
