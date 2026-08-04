/**
 * Layout/revision acceptance tests: the served composite names its build
 * revision, and the layout endpoint returns the grid captured by the same
 * build — so an overlay can only draw names over the exact image they
 * belong to (TAP-02, issue #129; builds on the monotonic revision of #108).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SESSION_A,
  authHeaders,
  getComposite,
  makeJpeg,
  postFrame,
  sleep,
  startService,
  testConfig,
} from "./helpers.js";

interface LayoutBody {
  revision: number;
  columns: number;
  rows: number;
  tileSizePx: number;
  cells: Array<{ id: string; column: number; row: number }>;
}

async function getLayout(baseUrl: string, sessionId: string): Promise<Response> {
  return fetch(`${baseUrl}/tapestry/sessions/${sessionId}/layout`, {
    headers: authHeaders(),
  });
}

test("the composite names its build revision and the layout matches the same build", async () => {
  const service = await startService(testConfig());
  try {
    await postFrame(service.baseUrl, SESSION_A, "zz", await makeJpeg(255, 0, 0));
    await postFrame(service.baseUrl, SESSION_A, "aa", await makeJpeg(0, 0, 255));
    await postFrame(service.baseUrl, SESSION_A, "mm", await makeJpeg(0, 220, 0));

    const composite = await getComposite(service.baseUrl, SESSION_A);
    assert.equal(composite.status, 200);
    const revision = composite.headers.get("x-tapestry-revision");
    assert.ok(revision, "the composite carries its build revision");

    const layoutRes = await getLayout(service.baseUrl, SESSION_A);
    assert.equal(layoutRes.status, 200);
    const layout = (await layoutRes.json()) as LayoutBody;
    assert.equal(String(layout.revision), revision, "layout and composite describe one build");
    assert.equal(layout.columns, 3);
    assert.equal(layout.rows, 1);
    assert.equal(layout.tileSizePx, 100);
    // First-seen order: zz arrived first, then aa, then mm.
    assert.deepEqual(layout.cells, [
      { id: "zz", column: 0, row: 0 },
      { id: "aa", column: 1, row: 0 },
      { id: "mm", column: 2, row: 0 },
    ]);
  } finally {
    await service.close();
  }
});

test("a rebuild advances both revision and layout atomically", async () => {
  const service = await startService(testConfig());
  try {
    await postFrame(service.baseUrl, SESSION_A, "p1", await makeJpeg(255, 0, 0));
    const first = await getComposite(service.baseUrl, SESSION_A);
    const firstRevision = first.headers.get("x-tapestry-revision");

    await postFrame(service.baseUrl, SESSION_A, "p2", await makeJpeg(0, 0, 255));
    await sleep(1100); // rebuild rate limit
    const second = await getComposite(service.baseUrl, SESSION_A);
    const secondRevision = second.headers.get("x-tapestry-revision");
    assert.ok(secondRevision && secondRevision !== firstRevision, "a new build advances the revision");

    const layout = (await (await getLayout(service.baseUrl, SESSION_A)).json()) as LayoutBody;
    assert.equal(String(layout.revision), secondRevision);
    assert.deepEqual(layout.cells, [
      { id: "p1", column: 0, row: 0 },
      { id: "p2", column: 1, row: 0 },
    ]);
  } finally {
    await service.close();
  }
});

test("the layout wraps to a second row at the column cap", async () => {
  const service = await startService(testConfig({ gridColumns: 2 }));
  try {
    await postFrame(service.baseUrl, SESSION_A, "a", await makeJpeg(255, 0, 0));
    await postFrame(service.baseUrl, SESSION_A, "b", await makeJpeg(0, 255, 0));
    await postFrame(service.baseUrl, SESSION_A, "c", await makeJpeg(0, 0, 255));
    await getComposite(service.baseUrl, SESSION_A);

    const layout = (await (await getLayout(service.baseUrl, SESSION_A)).json()) as LayoutBody;
    assert.equal(layout.columns, 2);
    assert.equal(layout.rows, 2);
    assert.deepEqual(layout.cells, [
      { id: "a", column: 0, row: 0 },
      { id: "b", column: 1, row: 0 },
      { id: "c", column: 0, row: 1 },
    ]);
  } finally {
    await service.close();
  }
});

test("layout is 404 before the first build and 401 without the secret", async () => {
  const service = await startService(testConfig());
  try {
    const early = await getLayout(service.baseUrl, SESSION_A);
    assert.equal(early.status, 404);

    const unauthorized = await fetch(`${service.baseUrl}/tapestry/sessions/${SESSION_A}/layout`);
    assert.equal(unauthorized.status, 401);
  } finally {
    await service.close();
  }
});

test("an empty build still publishes a truthful 1x1 layout with no cells", async () => {
  const service = await startService(testConfig());
  try {
    const composite = await getComposite(service.baseUrl, SESSION_A);
    const revision = composite.headers.get("x-tapestry-revision");
    const layout = (await (await getLayout(service.baseUrl, SESSION_A)).json()) as LayoutBody;
    assert.equal(String(layout.revision), revision);
    assert.deepEqual(layout.cells, []);
    assert.equal(layout.columns, 1);
    assert.equal(layout.rows, 1);
  } finally {
    await service.close();
  }
});
