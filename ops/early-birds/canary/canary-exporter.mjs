import http from 'node:http';
import fs from 'node:fs/promises';

const manifestUrlFile = process.env.BEACON_CANARY_MANIFEST_URL_FILE ?? '/run/secrets/canary_manifest_url';
const intervalMs = Number(process.env.BEACON_CANARY_INTERVAL_MS ?? 30_000);
const timeoutMs = Number(process.env.BEACON_CANARY_TIMEOUT_MS ?? 10_000);
const port = Number(process.env.CANARY_EXPORTER_PORT ?? 8081);

export function parseManifest(manifest, nowMs = Date.now()) {
  if (!manifest.startsWith('#EXTM3U\n')) throw new Error('not an HLS manifest');
  const segmentUrl = manifest.split('\n').find((line) => /^https?:\/\//.test(line));
  if (!segmentUrl) throw new Error('manifest has no segment URL');
  const programTimes = manifest.split('\n')
    .filter((line) => line.startsWith('#EXT-X-PROGRAM-DATE-TIME:'))
    .map((line) => Date.parse(line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length)))
    .filter(Number.isFinite);
  if (!programTimes.length) throw new Error('manifest has no program date time');
  return { segmentUrl, manifestAgeSeconds: Math.max(0, (nowMs - programTimes.at(-1)) / 1000) };
}

async function readManifestUrl() {
  const value = (await fs.readFile(manifestUrlFile, 'utf8')).trim();
  if (!/^https?:\/\//.test(value)) throw new Error('manifest URL must be HTTP(S)');
  return value;
}

export async function probe({ fetchImpl = fetch, nowMs = () => Date.now() } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = nowMs();
  try {
    const manifestResponse = await fetchImpl(await readManifestUrl(), { cache: 'no-store', signal: controller.signal });
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
    const { segmentUrl, manifestAgeSeconds } = parseManifest(await manifestResponse.text(), nowMs());
    const segmentResponse = await fetchImpl(segmentUrl, { cache: 'no-store', signal: controller.signal });
    if (!segmentResponse.ok) throw new Error(`segment HTTP ${segmentResponse.status}`);
    const segmentBytes = (await segmentResponse.arrayBuffer()).byteLength;
    if (!segmentBytes) throw new Error('empty segment');
    return { ok: 1, manifestAgeSeconds, segmentBytes, durationSeconds: (nowMs() - startedAt) / 1000, completedAtSeconds: nowMs() / 1000 };
  } catch {
    // URL and exception details may contain an HMAC. The exporter emits state only.
    return { ok: 0, manifestAgeSeconds: 0, segmentBytes: 0, durationSeconds: (nowMs() - startedAt) / 1000, completedAtSeconds: nowMs() / 1000 };
  } finally {
    clearTimeout(timer);
  }
}

function metrics(state) {
  return [
    '# HELP beacon_stream_canary_ok 1 when the HTTP HLS canary fetched a non-empty segment.',
    '# TYPE beacon_stream_canary_ok gauge',
    `beacon_stream_canary_ok ${state.ok}`,
    '# HELP beacon_stream_canary_manifest_age_seconds Age of the newest HLS program date time.',
    '# TYPE beacon_stream_canary_manifest_age_seconds gauge',
    `beacon_stream_canary_manifest_age_seconds ${state.manifestAgeSeconds}`,
    '# HELP beacon_stream_canary_segment_bytes Bytes fetched from the current canary segment.',
    '# TYPE beacon_stream_canary_segment_bytes gauge',
    `beacon_stream_canary_segment_bytes ${state.segmentBytes}`,
    '# HELP beacon_stream_canary_probe_duration_seconds End-to-end HTTP canary duration.',
    '# TYPE beacon_stream_canary_probe_duration_seconds gauge',
    `beacon_stream_canary_probe_duration_seconds ${state.durationSeconds}`,
    '# HELP beacon_stream_canary_last_completed_unixtime Last completed canary probe.',
    '# TYPE beacon_stream_canary_last_completed_unixtime gauge',
    `beacon_stream_canary_last_completed_unixtime ${state.completedAtSeconds}`,
    '',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let state = { ok: 0, manifestAgeSeconds: 0, segmentBytes: 0, durationSeconds: 0, completedAtSeconds: 0 };
  const run = async () => { state = await probe(); };
  await run();
  setInterval(run, intervalMs).unref();
  http.createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(metrics(state));
  }).listen(port, '0.0.0.0');
}
