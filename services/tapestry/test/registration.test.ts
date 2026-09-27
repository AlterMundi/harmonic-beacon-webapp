import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TapestryStore } from '../src/store.js';
import { MAX_REGISTERED_SESSIONS } from '../src/server.js';
import { authHeaders, getComposite, makeJpeg, postFrame, startService, testConfig } from './helpers.js';

test('new event requires authenticated registration and then ingests and composes without restart', async () => {
  const service = await startService(testConfig());
  try {
    const path = `${service.baseUrl}/tapestry/sessions/new-event`;
    assert.equal((await getComposite(service.baseUrl, 'new-event')).status, 404);
    assert.equal((await fetch(path, { method: 'PUT' })).status, 401);
    assert.equal((await getComposite(service.baseUrl, 'new-event')).status, 404);
    assert.equal((await fetch(path, { method: 'PUT', headers: authHeaders() })).status, 200);
    assert.equal((await postFrame(service.baseUrl, 'new-event', 'opaque-person', await makeJpeg(220, 10, 10))).status, 201);
    assert.equal((await getComposite(service.baseUrl, 'new-event')).status, 200);
    const layout = await fetch(`${path}/layout`, { headers: authHeaders() });
    const body = await layout.json() as { cells: unknown[] };
    assert.equal(body.cells.length, 1);
    assert.equal((await fetch(path, { method: 'PUT', headers: authHeaders() })).status, 200);
    const repeated = await fetch(`${path}/layout`, { headers: authHeaders() });
    assert.deepEqual((await repeated.json() as { cells: unknown[] }).cells, body.cells);
  } finally { await service.close(); }
});

test('registration capacity is bounded without rejecting retries', async () => {
  const service = await startService(testConfig({ sessionIds: [] }));
  try {
    for (let i = 0; i < MAX_REGISTERED_SESSIONS; i++) {
      assert.equal((await fetch(`${service.baseUrl}/tapestry/sessions/s-${i}`, { method: 'PUT', headers: authHeaders() })).status, 200);
    }
    assert.equal((await fetch(`${service.baseUrl}/tapestry/sessions/overflow`, { method: 'PUT', headers: authHeaders() })).status, 429);
    assert.equal((await fetch(`${service.baseUrl}/tapestry/sessions/s-0`, { method: 'PUT', headers: authHeaders() })).status, 200);
  } finally { await service.close(); }
});

test('inactivity removes dynamic frames and arrangement, retains seeds and permits fresh admission', () => {
  const store = new TapestryStore(['seed'], 2);
  assert.equal(store.registerSession('dynamic', 100, 2), true);
  store.ingest('dynamic', 'person', Buffer.from('tile'), 100);
  store.setOrder('dynamic', ['person']);
  store.touchSession('dynamic', 150);
  assert.deepEqual(store.expireDynamicSessions(200, 100), []);
  assert.deepEqual(store.expireDynamicSessions(250, 100), ['dynamic']);
  assert.equal(store.hasSession('seed'), true);
  assert.equal(store.participantCount(), 0);
  assert.equal(store.registerSession('fresh', 250, 2), true);
});

test('appearance confirmation expires with the completed composite', async () => {
  const { TapestryCompositor } = await import('../src/composite.js');
  let now = 1_000;
  const config = testConfig({ frameTtlMs: 100 });
  const store = new TapestryStore(config.sessionIds, config.maxParticipantsPerSession);
  const compositor = new TapestryCompositor(config, store, () => now);
  store.ingest(config.sessionIds[0], 'person', await makeJpeg(10, 20, 30, 100), now);
  assert.equal(compositor.hasPublishedParticipant(config.sessionIds[0], 'person'), false);
  await compositor.composite(config.sessionIds[0]);
  assert.equal(compositor.hasPublishedParticipant(config.sessionIds[0], 'person'), true);
  now += 101;
  assert.equal(compositor.hasPublishedParticipant(config.sessionIds[0], 'person'), false);
});
