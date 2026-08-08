import assert from 'node:assert/strict';
import test from 'node:test';

import { MONITOR_THRESHOLDS, validateTargetMonitorStatus } from '../src/smoke-safety.mjs';
import {
  LISTENER_READY_URL,
  LIVE_READY_URL,
  MONITOR_QUERIES,
  STREAM_HEALTH_URL,
  createContainerBaseline,
  loopbackTunnelOrigin,
  probeMonitor,
} from '../src/target-probe.mjs';

const TEST_HOST_HASH = '0123456789ab';
const PROMETHEUS = 'http://127.0.0.1:19090';
const ALERTMANAGER = 'http://127.0.0.1:19093';
const HEALTH_URLS = [LISTENER_READY_URL, STREAM_HEALTH_URL, LIVE_READY_URL];

const DEFAULT_SCALARS = {
  cpuUsedRatio: 0.2,
  memoryUsedRatio: 0.4,
  rootFreeRatio: 0.6,
  egressBitsPerSecond: 500_000_000,
  tcpRetransmitRatio: 0.001,
  interfaceErrorsDrops: 0,
  originUp: 1,
  canaryOk: 1,
  listenerStartSeconds: 1_700_000_000,
  originStartSeconds: 1_700_000_100,
  listenerOomEvents: 0,
  originOomEvents: 0,
};

function fakeJsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function vectorResult(values) {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: values.map((value) => ({ metric: {}, value: [1_700_000_000, String(value)] })),
    },
  };
}

// Fully in-process fake: routes by URL and reads `state` live so a test can
// change telemetry between probes. No socket is ever opened.
function makeFetch(state) {
  return async (url) => {
    const text = String(url);
    if (state.failUrls?.(text)) throw new Error('injected connection failure');
    if (HEALTH_URLS.some((healthUrl) => text.startsWith(healthUrl))) {
      const ok = state.healthOk !== false;
      return {
        ok,
        status: ok ? 200 : 503,
        headers: {
          get: (name) => (name === 'x-harmonic-beacon-environment' && ok
            ? 'early-birds-staging'
            : null),
        },
      };
    }
    if (text.includes('/api/v2/status')) {
      if (state.alertmanagerStatusError) return fakeJsonResponse({}, { ok: false, status: 500 });
      return fakeJsonResponse(state.alertmanagerStatus ?? { cluster: { status: 'ready' } });
    }
    if (text.includes('/api/v2/alerts')) {
      return fakeJsonResponse(state.alertmanagerAlerts ?? []);
    }
    if (text.includes('/api/v1/alerts')) {
      return fakeJsonResponse({
        status: 'success',
        data: { alerts: state.firingAlerts ?? [] },
      });
    }
    if (text.includes('/api/v1/query')) {
      const query = new URL(text).searchParams.get('query');
      const name = Object.keys(MONITOR_QUERIES).find((key) => MONITOR_QUERIES[key] === query);
      assert.ok(name, `unexpected query ${query}`);
      if (state.scalarResults && name in state.scalarResults) {
        return fakeJsonResponse(state.scalarResults[name]);
      }
      const value = state.scalars && name in state.scalars
        ? state.scalars[name]
        : DEFAULT_SCALARS[name];
      return fakeJsonResponse(vectorResult([value]));
    }
    throw new Error(`unexpected URL ${text}`);
  };
}

async function probeTwice(state = {}) {
  const baseline = createContainerBaseline();
  const options = {
    fetchImpl: makeFetch(state),
    prometheusOrigin: PROMETHEUS,
    alertmanagerOrigin: ALERTMANAGER,
    hostHash: TEST_HOST_HASH,
    baseline,
  };
  const first = await probeMonitor(options);
  const second = await probeMonitor(options);
  return { first, second, baseline };
}

test('loopback tunnel origins are validated exactly', () => {
  assert.equal(loopbackTunnelOrigin('http://127.0.0.1:19090', 'Prometheus'), 'http://127.0.0.1:19090');
  assert.equal(loopbackTunnelOrigin('http://[::1]:19093/', 'Alertmanager'), 'http://[::1]:19093');
  for (const bad of [
    'https://127.0.0.1:19090',
    'http://user:pass@127.0.0.1:19090',
    'http://mona.example:9090',
    'http://127.0.0.1:19090/api',
    'http://127.0.0.1:19090?x=1',
    'not-a-url',
  ]) {
    assert.throws(() => loopbackTunnelOrigin(bad, 'Prometheus'), /loopback SSH tunnel origin/);
  }
});

test('a healthy target passes only after the restart/OOM baseline is verified', async () => {
  const { first, second } = await probeTwice();
  assert.equal(first.status, 'FAIL');
  assert.equal(first.restartBaselineEstablished, false);
  assert.throws(() => validateTargetMonitorStatus(first), /not passing|baseline/);
  assert.equal(second.status, 'PASS');
  assert.equal(second.restartBaselineEstablished, true);
  assert.equal(second.containerRestartsObserved, 0);
  assert.equal(second.oomEventsDelta, 0);
  assert.deepEqual(second.thresholds, { ...MONITOR_THRESHOLDS });
  assert.doesNotThrow(() => validateTargetMonitorStatus(second));
  // The status must not leak hostnames, URLs, labels or raw payloads.
  const serialized = JSON.stringify(second);
  assert.ok(!/harmonicbeacon|127\.0\.0\.1|19090|19093|container_|node_/.test(serialized.replace(
    /https:\/\/stream\.harmonicbeacon\.com/,
    '',
  )));
});

test('Alertmanager unavailable, unready, firing or malformed fails closed', async () => {
  const unavailable = await probeTwice({ failUrls: (url) => url.includes('/api/v2/') });
  assert.equal(unavailable.second.status, 'FAIL');
  assert.equal(unavailable.second.alertmanagerReady, false);

  const settling = await probeTwice({ alertmanagerStatus: { cluster: { status: 'settling' } } });
  assert.equal(settling.second.status, 'FAIL');
  assert.equal(settling.second.alertmanagerReady, false);

  const firing = await probeTwice({
    alertmanagerAlerts: [{ status: { state: 'active', silencedBy: [], inhibitedBy: [] } }],
  });
  assert.equal(firing.second.status, 'FAIL');
  assert.equal(firing.second.activeAlerts, 1);

  const silenced = await probeTwice({
    alertmanagerAlerts: [{ status: { state: 'active', silencedBy: ['abc'], inhibitedBy: [] } }],
  });
  assert.equal(silenced.second.status, 'PASS');
  assert.equal(silenced.second.activeAlerts, 0);

  const notAnArray = await probeTwice({ alertmanagerAlerts: { alerts: [] } });
  assert.equal(notAnArray.second.status, 'FAIL');

  const malformedEntry = await probeTwice({ alertmanagerAlerts: [{ unexpected: true }] });
  assert.equal(malformedEntry.second.status, 'FAIL');

  const failedStatus = await probeTwice({ alertmanagerStatusError: true });
  assert.equal(failedStatus.second.status, 'FAIL');

  const malformedStatus = await probeTwice({ alertmanagerStatus: [1, 2, 3] });
  assert.equal(malformedStatus.second.status, 'FAIL');
});

test('firing Prometheus rules fail even when Alertmanager is quiet', async () => {
  const { second } = await probeTwice({ firingAlerts: [{ state: 'firing' }, { state: 'pending' }] });
  assert.equal(second.status, 'FAIL');
  assert.equal(second.prometheusFiringAlerts, 1);
});

test('missing, ambiguous or non-finite scalar results fail closed', async () => {
  for (const name of Object.keys(DEFAULT_SCALARS)) {
    const missing = await probeTwice({ scalarResults: { [name]: vectorResult([]) } });
    assert.equal(missing.second.status, 'FAIL', `${name} missing must fail`);
    const ambiguous = await probeTwice({ scalarResults: { [name]: vectorResult([1, 1]) } });
    assert.equal(ambiguous.second.status, 'FAIL', `${name} ambiguous must fail`);
    const notFinite = await probeTwice({ scalarResults: { [name]: vectorResult(['NaN']) } });
    assert.equal(notFinite.second.status, 'FAIL', `${name} NaN must fail`);
    const infinite = await probeTwice({ scalarResults: { [name]: vectorResult(['+Inf']) } });
    assert.equal(infinite.second.status, 'FAIL', `${name} Inf must fail`);
  }
});

test('immediate stop thresholds are enforced at their exact edges', async () => {
  const edges = [
    ['cpuUsedRatio', MONITOR_THRESHOLDS.maxCpuUsedRatio, 0.499],
    ['memoryUsedRatio', MONITOR_THRESHOLDS.maxMemoryUsedRatio, 0.699],
    ['rootFreeRatio', MONITOR_THRESHOLDS.minRootFreeRatio, 0.301],
    ['egressBitsPerSecond', MONITOR_THRESHOLDS.maxEgressBitsPerSecond, 1_499_999_999],
    ['tcpRetransmitRatio', MONITOR_THRESHOLDS.maxTcpRetransmitRatio, 0.0099],
    ['interfaceErrorsDrops', 1, 0],
    ['canaryOk', 0, 1],
    ['originUp', 0, 1],
  ];
  for (const [name, failingValue, passingValue] of edges) {
    const failing = await probeTwice({ scalars: { [name]: failingValue } });
    assert.equal(failing.second.status, 'FAIL', `${name}=${failingValue} must fail`);
    const passing = await probeTwice({ scalars: { [name]: passingValue } });
    assert.equal(passing.second.status, 'PASS', `${name}=${passingValue} must pass`);
  }
});

test('a changed container start timestamp is latched as a restart', async () => {
  const state = { scalars: {} };
  const baseline = createContainerBaseline();
  const options = {
    fetchImpl: makeFetch(state),
    prometheusOrigin: PROMETHEUS,
    alertmanagerOrigin: ALERTMANAGER,
    hostHash: TEST_HOST_HASH,
    baseline,
  };
  await probeMonitor(options);
  const clean = await probeMonitor(options);
  assert.equal(clean.status, 'PASS');
  state.scalars.listenerStartSeconds = DEFAULT_SCALARS.listenerStartSeconds + 60;
  const restarted = await probeMonitor(options);
  assert.equal(restarted.status, 'FAIL');
  assert.equal(restarted.containerRestartsObserved, 1);
  assert.throws(() => validateTargetMonitorStatus(restarted), /restart or OOM|not passing/);
  // The latch persists: later samples cannot quietly re-pass.
  const latched = await probeMonitor(options);
  assert.equal(latched.status, 'FAIL');
  assert.equal(latched.containerRestartsObserved, 1);
});

test('an increased container OOM counter fails closed with a bounded delta', async () => {
  const state = { scalars: {} };
  const baseline = createContainerBaseline();
  const options = {
    fetchImpl: makeFetch(state),
    prometheusOrigin: PROMETHEUS,
    alertmanagerOrigin: ALERTMANAGER,
    hostHash: TEST_HOST_HASH,
    baseline,
  };
  await probeMonitor(options);
  assert.equal((await probeMonitor(options)).status, 'PASS');
  state.scalars.originOomEvents = 2;
  const oomed = await probeMonitor(options);
  assert.equal(oomed.status, 'FAIL');
  assert.equal(oomed.oomEventsDelta, 2);
});

test('a degraded health endpoint fails the probe without sensitive detail', async () => {
  const { second } = await probeTwice({ healthOk: false });
  assert.equal(second.status, 'FAIL');
  assert.equal(second.listenerReady, false);
  assert.equal(second.streamHealthy, false);
  assert.equal(second.liveReady, false);
});
