import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendTapestryFrame } from '../../../src/lib/tapestry.js';
import { authHeaders, getComposite, makeJpeg, startService, testConfig, TEST_SECRET } from './helpers.js';

test('app relay recovers a new event through real internal HTTP and preserves repeat uploads', async () => {
  let service = await startService(testConfig());
  const oldSecret = process.env.TAPESTRY_INTERNAL_SECRET;
  process.env.TAPESTRY_INTERNAL_SECRET = TEST_SECRET;
  try {
    const bytes = new Uint8Array(await makeJpeg(30, 200, 20)).buffer;
    assert.equal((await sendTapestryFrame(service.baseUrl, 'future-event', 'opaque-person', bytes)).status, 201);
    assert.equal((await getComposite(service.baseUrl, 'future-event')).status, 200);
    const layout = await fetch(`${service.baseUrl}/tapestry/sessions/future-event/layout`, { headers: authHeaders() });
    assert.equal((await layout.json() as { cells: unknown[] }).cells.length, 1);
    assert.equal((await sendTapestryFrame(service.baseUrl, 'future-event', 'opaque-person', bytes)).status, 200);
    await service.close();
    service = await startService(testConfig());
    assert.equal((await getComposite(service.baseUrl, 'future-event')).status, 404);
    assert.equal((await sendTapestryFrame(service.baseUrl, 'future-event', 'opaque-person', bytes)).status, 201);
    assert.equal((await getComposite(service.baseUrl, 'future-event')).status, 200);
  } finally {
    if (oldSecret === undefined) delete process.env.TAPESTRY_INTERNAL_SECRET;
    else process.env.TAPESTRY_INTERNAL_SECRET = oldSecret;
    await service.close();
  }
});

test('receipt distinguishes accepted frames from appearance in a completed composite', async () => {
  const service = await startService(testConfig());
  const oldSecret = process.env.TAPESTRY_INTERNAL_SECRET;
  process.env.TAPESTRY_INTERNAL_SECRET = TEST_SECRET;
  try {
    const bytes = new Uint8Array(await makeJpeg(100, 20, 10)).buffer;
    const first = await sendTapestryFrame(service.baseUrl, 'new-event', 'opaque-person', bytes);
    assert.equal((await first.json() as { state: string }).state, 'composing');
    await getComposite(service.baseUrl, 'new-event');
    const next = await sendTapestryFrame(service.baseUrl, 'new-event', 'opaque-person', bytes);
    assert.equal((await next.json() as { state: string }).state, 'published');
  } finally {
    if (oldSecret === undefined) delete process.env.TAPESTRY_INTERNAL_SECRET;
    else process.env.TAPESTRY_INTERNAL_SECRET = oldSecret;
    await service.close();
  }
});
