import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeaconAudibility } from '../src/beaconAudibility.js';

test('digital silence and low level noise do not displace the bed', () => {
  const monitor = new BeaconAudibility();
  monitor.observe('source', new Int16Array(960), 1000);
  monitor.observe('source', new Int16Array(960).fill(20), 1000);
  assert.equal(monitor.audible(['source'], 1001), false);
});

test('quiet music survives brief pauses but expires without new audible PCM', () => {
  const monitor = new BeaconAudibility();
  monitor.observe('source', new Int16Array(960).fill(40), 1000);
  assert.equal(monitor.audible(['source'], 1001), true);
  monitor.observe('source', new Int16Array(960), 2000);
  assert.equal(monitor.audible(['source'], 3999), true);
  assert.equal(monitor.audible(['source'], 4000), false);
});

test('retired or muted track state cannot suppress fallback for its replacement', () => {
  const monitor = new BeaconAudibility();
  monitor.observe('old', new Int16Array(960).fill(4000), 1000);
  assert.equal(monitor.audible(['replacement'], 1001), false);
  monitor.forget('old');
  assert.equal(monitor.audible(['old'], 1001), false);
  monitor.observe('replacement', new Int16Array(960).fill(4000), 1002);
  monitor.clear();
  assert.equal(monitor.audible(['replacement'], 1003), false);
});
