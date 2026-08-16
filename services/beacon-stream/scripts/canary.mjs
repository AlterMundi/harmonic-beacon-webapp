function environment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const manifestUrl = environment('BEACON_CANARY_MANIFEST_URL');
const timeoutMs = Number(process.env.BEACON_CANARY_TIMEOUT_MS ?? 10_000);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

try {
  const manifestResponse = await fetch(manifestUrl, { signal: controller.signal, cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.text();
  if (!manifest.startsWith('#EXTM3U\n')) throw new Error('manifest is not HLS');
  const segmentUrl = manifest.split('\n').find((line) => /^https?:\/\//.test(line));
  if (!segmentUrl) throw new Error('manifest has no signed segment URL');
  const segmentResponse = await fetch(segmentUrl, { signal: controller.signal, cache: 'no-store' });
  if (!segmentResponse.ok) throw new Error(`segment HTTP ${segmentResponse.status}`);
  const bytes = (await segmentResponse.arrayBuffer()).byteLength;
  if (!bytes) throw new Error('segment is empty');
  console.log(JSON.stringify({ status: 'ok', segmentBytes: bytes }));
} catch (error) {
  // The URL may contain an HMAC; never print it from an operator canary.
  console.error(JSON.stringify({ status: 'failed', reason: error.name === 'AbortError' ? 'timeout' : error.message }));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
