function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function positive(name, fallback) {
  const value = Number(argument(name, fallback));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

const manifestUrl = argument('--manifest');
if (!manifestUrl) throw new Error('usage: node scripts/load-hls.mjs --manifest <short-lived signed URL> [--clients 20] [--rounds 10] [--max-error-rate 0.01]');
const clients = positive('--clients', '20');
const rounds = positive('--rounds', '10');
const maxErrorRate = Number(argument('--max-error-rate', '0.01'));
if (!(maxErrorRate >= 0 && maxErrorRate <= 1)) throw new Error('--max-error-rate must be between 0 and 1');

const startedAt = performance.now();
let requests = 0;
let failures = 0;
let bytes = 0;
const durations = [];
async function request(url) {
  const start = performance.now();
  requests += 1;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.arrayBuffer();
    if (!body.byteLength) throw new Error('empty response');
    bytes += body.byteLength;
  } catch {
    failures += 1;
  } finally {
    durations.push(performance.now() - start);
  }
}
async function client() {
  for (let round = 0; round < rounds; round += 1) {
    const start = performance.now();
    requests += 1;
    try {
      const response = await fetch(manifestUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.text();
      const urls = manifest.split('\n').filter((line) => /^https?:\/\//.test(line));
      if (!urls.length) throw new Error('manifest without segment URI');
      await request(urls[urls.length - 1]);
    } catch {
      failures += 1;
    } finally {
      durations.push(performance.now() - start);
    }
  }
}
await Promise.all(Array.from({ length: clients }, client));
durations.sort((a, b) => a - b);
const percentile = (p) => durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] : 0;
const report = {
  clients,
  rounds,
  requests,
  failures,
  errorRate: requests ? failures / requests : 1,
  bytes,
  elapsedSeconds: (performance.now() - startedAt) / 1000,
  requestDurationMs: { p95: percentile(0.95), p99: percentile(0.99) },
};
console.log(JSON.stringify(report));
if (report.errorRate > maxErrorRate) process.exitCode = 1;
