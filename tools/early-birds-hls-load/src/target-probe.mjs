import {
  MONITOR_THRESHOLDS,
  SMOKE_ORIGIN,
  SMOKE_TARGET_ID,
  TARGET_MONITOR_KIND,
  TARGET_MONITOR_ROLE,
} from './smoke-safety.mjs';

export const LISTENER_READY_URL = 'https://earlybirds-staging.harmonicbeacon.com/api/health/ready';
export const STREAM_HEALTH_URL = `${SMOKE_ORIGIN}/healthz`;
export const LIVE_READY_URL = 'https://live.harmonicbeacon.com/api/health/ready';
export const STAGING_ATTESTATION = 'early-birds-staging';

// Exact isolated staging containers on the target host, from the checked-in
// earlybirds-preview Compose project. Never participant or event containers.
export const LISTENER_CONTAINER = 'earlybirds-preview-listener-1';
export const ORIGIN_CONTAINER = 'earlybirds-preview-beacon-stream-1';

// Instant Prometheus queries. Every query must yield exactly one vector
// element; an empty, duplicated or non-finite result fails the probe. Host
// scalars aggregate in PromQL so multi-device cardinality cannot silently
// pick one interface or core.
export const MONITOR_QUERIES = Object.freeze({
  cpuUsedRatio: '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[1m]))',
  memoryUsedRatio: '1 - (sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes))',
  rootFreeRatio: 'sum(node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"})'
    + ' / sum(node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"})',
  egressBitsPerSecond:
    'sum(rate(node_network_transmit_bytes_total{device!~"lo|docker.*|veth.*"}[2m])) * 8',
  tcpRetransmitRatio: 'sum(rate(node_netstat_Tcp_RetransSegs[2m]))'
    + ' / clamp_min(sum(rate(node_netstat_Tcp_OutSegs[2m])), 1)',
  interfaceErrorsDrops:
    'sum(node_network_transmit_errs_total{device!~"lo|docker.*|veth.*"})'
    + ' + sum(node_network_receive_errs_total{device!~"lo|docker.*|veth.*"})'
    + ' + sum(node_network_transmit_drop_total{device!~"lo|docker.*|veth.*"})'
    + ' + sum(node_network_receive_drop_total{device!~"lo|docker.*|veth.*"})',
  originUp: 'up{job="beacon-stream"}',
  canaryOk: 'beacon_stream_canary_ok',
  listenerStartSeconds: `container_start_time_seconds{name="${LISTENER_CONTAINER}"}`,
  originStartSeconds: `container_start_time_seconds{name="${ORIGIN_CONTAINER}"}`,
  listenerOomEvents: `container_oom_events_total{name="${LISTENER_CONTAINER}"}`,
  originOomEvents: `container_oom_events_total{name="${ORIGIN_CONTAINER}"}`,
});

export function loopbackTunnelOrigin(value, label) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`${label} must be an uncredentialed loopback SSH tunnel origin`);
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be an uncredentialed loopback SSH tunnel origin`);
  }
  return url.origin;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error('monitoring query failed');
  try {
    return await response.json();
  } catch {
    throw new Error('monitoring query returned malformed JSON');
  }
}

// Exactly one unambiguous, finite vector element or a thrown refusal. Missing,
// duplicated, NaN and +/-Inf results can never become a passing scalar.
export async function queryPrometheusScalar(fetchImpl, prometheusOrigin, query) {
  const url = `${prometheusOrigin}/api/v1/query?query=${encodeURIComponent(query)}`;
  const body = await fetchJson(fetchImpl, url);
  if (body?.status !== 'success' || body?.data?.resultType !== 'vector'
    || !Array.isArray(body.data.result)) {
    throw new Error('Prometheus query response is malformed');
  }
  if (body.data.result.length !== 1) {
    throw new Error('Prometheus query result is missing or ambiguous');
  }
  const point = body.data.result[0]?.value;
  if (!Array.isArray(point) || point.length !== 2) {
    throw new Error('Prometheus query sample is malformed');
  }
  const value = Number(point[1]);
  if (!Number.isFinite(value)) throw new Error('Prometheus query sample is not finite');
  return value;
}

export async function fetchPrometheusFiringAlerts(fetchImpl, prometheusOrigin) {
  const body = await fetchJson(fetchImpl, `${prometheusOrigin}/api/v1/alerts`);
  if (body?.status !== 'success' || !Array.isArray(body?.data?.alerts)) {
    throw new Error('Prometheus alerts response is malformed');
  }
  return body.data.alerts.filter((alert) => alert?.state === 'firing').length;
}

// Alertmanager is queried directly; its health is never inferred from
// Prometheus. Any malformed, missing or failed response fails closed.
export async function fetchAlertmanagerState(fetchImpl, alertmanagerOrigin) {
  const status = await fetchJson(fetchImpl, `${alertmanagerOrigin}/api/v2/status`);
  const ready = status?.cluster?.status === 'ready';
  const alerts = await fetchJson(
    fetchImpl,
    `${alertmanagerOrigin}/api/v2/alerts?active=true&silenced=false&inhibited=false`,
  );
  if (!Array.isArray(alerts) || alerts.length > 10_000) {
    throw new Error('Alertmanager alerts response is malformed');
  }
  let activeAlerts = 0;
  for (const alert of alerts) {
    const state = alert?.status?.state;
    if (typeof state !== 'string') throw new Error('Alertmanager alert entry is malformed');
    const silenced = Array.isArray(alert.status.silencedBy) && alert.status.silencedBy.length > 0;
    const inhibited = Array.isArray(alert.status.inhibitedBy) && alert.status.inhibitedBy.length > 0;
    if (state === 'active' && !silenced && !inhibited) activeAlerts += 1;
  }
  return { ready, activeAlerts };
}

async function fetchHealth(fetchImpl, url, stagingAttestation) {
  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    if (stagingAttestation
      && response.headers.get('x-harmonic-beacon-environment') !== stagingAttestation) return false;
    return true;
  } catch {
    return false;
  }
}

// In-process restart/OOM baseline for the exact isolated Listener and origin
// containers. The first sample only establishes the baseline; a PASS requires
// a later sample that still matches it. A changed start timestamp or an
// increased OOM counter is latched and fails every subsequent probe.
export function createContainerBaseline() {
  return {
    established: false,
    verified: false,
    startSeconds: null,
    oomEvents: null,
    restartsObserved: 0,
    oomEventsDelta: 0,
  };
}

export function observeContainerBaseline(baseline, sample) {
  const starts = [sample.listenerStartSeconds, sample.originStartSeconds];
  const ooms = [sample.listenerOomEvents, sample.originOomEvents];
  if (!baseline.established) {
    baseline.established = true;
    baseline.startSeconds = starts;
    baseline.oomEvents = ooms;
    return;
  }
  starts.forEach((value, index) => {
    if (value !== baseline.startSeconds[index]) {
      baseline.restartsObserved += 1;
      baseline.startSeconds[index] = value;
      baseline.verified = false;
    }
  });
  ooms.forEach((value, index) => {
    const delta = value - baseline.oomEvents[index];
    if (delta > 0) {
      baseline.oomEventsDelta += delta;
      baseline.verified = false;
    }
    if (delta !== 0) baseline.oomEvents[index] = value;
  });
  if (baseline.restartsObserved === 0 && baseline.oomEventsDelta === 0) {
    baseline.verified = true;
  }
}

function withinImmediateThresholds(scalars) {
  return scalars.cpuUsedRatio < MONITOR_THRESHOLDS.maxCpuUsedRatio
    && scalars.memoryUsedRatio < MONITOR_THRESHOLDS.maxMemoryUsedRatio
    && scalars.rootFreeRatio > MONITOR_THRESHOLDS.minRootFreeRatio
    && scalars.egressBitsPerSecond < MONITOR_THRESHOLDS.maxEgressBitsPerSecond
    && scalars.tcpRetransmitRatio < MONITOR_THRESHOLDS.maxTcpRetransmitRatio
    && scalars.interfaceErrorsDrops === MONITOR_THRESHOLDS.maxInterfaceErrorsDrops
    && scalars.canaryOk === 1
    && scalars.originUp === 1;
}

// One monitor sample. The returned status carries only bounded numerics,
// booleans, the hashed host fingerprint, timing and the fixed thresholds;
// never raw Prometheus/Alertmanager payloads, labels, URLs or hostnames.
export async function probeMonitor({
  fetchImpl = fetch,
  prometheusOrigin,
  alertmanagerOrigin,
  hostHash,
  baseline,
  healthUrls = {
    listenerReady: LISTENER_READY_URL,
    streamHealthy: STREAM_HEALTH_URL,
    liveReady: LIVE_READY_URL,
  },
}) {
  const base = {
    schemaVersion: 1,
    kind: TARGET_MONITOR_KIND,
    role: TARGET_MONITOR_ROLE,
    status: 'FAIL',
    external: true,
    targetId: SMOKE_TARGET_ID,
    targetOrigin: SMOKE_ORIGIN,
    hostHash,
    observedAt: new Date().toISOString(),
    listenerReady: false,
    streamHealthy: false,
    liveReady: false,
    originUp: false,
    canaryOk: false,
    prometheusFiringAlerts: null,
    alertmanagerReady: false,
    activeAlerts: null,
    cpuUsedRatio: null,
    memoryUsedRatio: null,
    rootFreeRatio: null,
    egressBitsPerSecond: null,
    tcpRetransmitRatio: null,
    interfaceErrorsDrops: null,
    restartBaselineEstablished: baseline.verified,
    containerRestartsObserved: baseline.restartsObserved,
    oomEventsDelta: baseline.oomEventsDelta,
    thresholds: { ...MONITOR_THRESHOLDS },
  };
  try {
    const scalarNames = Object.keys(MONITOR_QUERIES);
    const [listenerReady, streamHealthy, liveReady, alertmanager, firingAlerts, ...scalarValues] = (
      await Promise.all([
        fetchHealth(fetchImpl, healthUrls.listenerReady, STAGING_ATTESTATION),
        fetchHealth(fetchImpl, healthUrls.streamHealthy, STAGING_ATTESTATION),
        fetchHealth(fetchImpl, healthUrls.liveReady, null),
        fetchAlertmanagerState(fetchImpl, alertmanagerOrigin),
        fetchPrometheusFiringAlerts(fetchImpl, prometheusOrigin),
        ...scalarNames.map((name) => queryPrometheusScalar(
          fetchImpl,
          prometheusOrigin,
          MONITOR_QUERIES[name],
        )),
      ])
    );
    const scalars = Object.fromEntries(scalarNames.map((name, index) => [name, scalarValues[index]]));
    observeContainerBaseline(baseline, {
      listenerStartSeconds: scalars.listenerStartSeconds,
      originStartSeconds: scalars.originStartSeconds,
      listenerOomEvents: scalars.listenerOomEvents,
      originOomEvents: scalars.originOomEvents,
    });
    const passed = listenerReady && streamHealthy && liveReady
      && alertmanager.ready && alertmanager.activeAlerts === 0 && firingAlerts === 0
      && withinImmediateThresholds(scalars)
      && baseline.verified
      && baseline.restartsObserved === 0 && baseline.oomEventsDelta === 0;
    return {
      ...base,
      status: passed ? 'PASS' : 'FAIL',
      observedAt: new Date().toISOString(),
      listenerReady,
      streamHealthy,
      liveReady,
      originUp: scalars.originUp === 1,
      canaryOk: scalars.canaryOk === 1,
      prometheusFiringAlerts: firingAlerts,
      alertmanagerReady: alertmanager.ready,
      activeAlerts: alertmanager.activeAlerts,
      cpuUsedRatio: scalars.cpuUsedRatio,
      memoryUsedRatio: scalars.memoryUsedRatio,
      rootFreeRatio: scalars.rootFreeRatio,
      egressBitsPerSecond: scalars.egressBitsPerSecond,
      tcpRetransmitRatio: scalars.tcpRetransmitRatio,
      interfaceErrorsDrops: scalars.interfaceErrorsDrops,
      restartBaselineEstablished: baseline.verified,
      containerRestartsObserved: baseline.restartsObserved,
      oomEventsDelta: baseline.oomEventsDelta,
    };
  } catch {
    return {
      ...base,
      observedAt: new Date().toISOString(),
      restartBaselineEstablished: baseline.verified,
      containerRestartsObserved: baseline.restartsObserved,
      oomEventsDelta: baseline.oomEventsDelta,
    };
  }
}
