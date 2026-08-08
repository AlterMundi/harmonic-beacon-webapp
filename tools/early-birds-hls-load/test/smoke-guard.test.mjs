import assert from 'node:assert/strict';
import test from 'node:test';

import { startStatusGuard } from '../src/smoke-guard.mjs';

function fakeTimer() {
  const handles = [];
  return {
    setIntervalImpl: (fn) => {
      const handle = { fn, cleared: false, unref() { return this; } };
      handles.push(handle);
      return handle;
    },
    clearIntervalImpl: (handle) => { handle.cleared = true; },
    tick: (index = 0) => {
      if (!handles[index].cleared) handles[index].fn();
    },
    handles,
  };
}

test('guard aborts exactly once on the first failed check', async () => {
  const timers = fakeTimer();
  let aborts = 0;
  let checks = 0;
  const guard = startStatusGuard({
    check: async () => {
      checks += 1;
      throw new Error('stale');
    },
    onAbort: () => { aborts += 1; },
    ...timers,
    writeImpl: () => {},
  });
  timers.tick();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  timers.tick();
  timers.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(aborts, 1);
  assert.equal(checks, 1);
  assert.equal(guard.aborted, true);
  assert.equal(timers.handles[0].cleared, true);
});

test('concurrent overlapping checks cannot double-abort', async () => {
  const timers = fakeTimer();
  let aborts = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const guard = startStatusGuard({
    check: async () => {
      await gate;
      throw new Error('failed');
    },
    onAbort: () => { aborts += 1; },
    ...timers,
    writeImpl: () => {},
  });
  timers.tick();
  timers.tick(); // ignored while the first check is still in flight
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(aborts, 1);
  assert.equal(guard.aborted, true);
});

test('passing checks never abort and stop() leaves the guard quiet', async () => {
  const timers = fakeTimer();
  let aborts = 0;
  let checks = 0;
  const guard = startStatusGuard({
    check: async () => { checks += 1; },
    onAbort: () => { aborts += 1; },
    ...timers,
    writeImpl: () => {},
  });
  timers.tick();
  await new Promise((resolve) => setImmediate(resolve));
  timers.tick();
  await new Promise((resolve) => setImmediate(resolve));
  guard.stop();
  timers.tick();
  assert.equal(aborts, 0);
  assert.equal(checks, 2);
  assert.equal(guard.aborted, false);
  assert.equal(guard.stopped, true);
});

test('an in-flight rejection after stop() emits no abort and never kills', async () => {
  const timers = fakeTimer();
  let aborts = 0;
  let writes = 0;
  let rejectCheck;
  const guard = startStatusGuard({
    check: () => new Promise((unused, reject) => { rejectCheck = reject; }),
    onAbort: () => { aborts += 1; },
    ...timers,
    writeImpl: () => { writes += 1; },
  });
  timers.tick(); // Starts one check that is still in flight.
  await new Promise((resolve) => setImmediate(resolve));
  guard.stop(); // The load child has exited; the guard is parked.
  rejectCheck(new Error('status failed after stop'));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  timers.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(aborts, 0);
  assert.equal(writes, 0);
  assert.equal(guard.aborted, false);
  assert.equal(guard.stopped, true);
});
