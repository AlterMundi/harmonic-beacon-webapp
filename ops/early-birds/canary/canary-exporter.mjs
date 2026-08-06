import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const signingSecretFile = process.env.BEACON_STREAM_SIGNING_SECRET_FILE ?? '/run/secrets/beacon_stream_signing_secret';
const publicOrigin = process.env.BEACON_STREAM_PUBLIC_ORIGIN;
const artifactId = process.env.BEACON_STREAM_ARTIFACT_ID;
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

function canonicalManifestPath(id) {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id ?? '')) throw new Error('invalid artifact ID');
  return `/v1/hls/${id}/live.m3u8`;
}

export function mintManifestUrl({ origin, id, secret, nowMs = Date.now(), ttlSeconds = 120 }) {
  if (!secret || secret.length < 32) throw new Error('invalid signing secret');
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 120) throw new Error('invalid token TTL');
  const pathname = canonicalManifestPath(id);
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
  const signature = crypto.createHmac('sha256', secret).update(`GET\n${pathname}\n${expiresAt}`).digest('base64url');
  const url = new URL(pathname, origin);
  url.searchParams.set('exp', String(expiresAt));
  url.searchParams.set('sig', signature);
  return url.toString();
}

async function readSigningSecret(file) {
  return (await fs.readFile(file, 'utf8')).trim();
}

export async function probe({
  fetchImpl = fetch,
  nowMs = () => Date.now(),
  origin = publicOrigin,
  id = artifactId,
  secretFile = signingSecretFile,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = nowMs();
  try {
    // A new <=120-second signature is minted on every probe. Origin tokens are
    // intentionally short-lived, so a static signed URL is never monitored.
    const manifestUrl = mintManifestUrl({ origin, id, secret: await readSigningSecret(secretFile), nowMs: nowMs() });
    const manifestResponse = await fetchImpl(manifestUrl, { cache: 'no-store', signal: controller.signal });
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
