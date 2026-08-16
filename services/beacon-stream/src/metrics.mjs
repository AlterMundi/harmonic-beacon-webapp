export class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.requests = new Map();
    this.bytesServed = 0;
    this.requestDurationSeconds = [];
  }

  observe({ route, status, bytes = 0, durationMs }) {
    const key = `${route}|${status}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    this.bytesServed += bytes;
    this.requestDurationSeconds.push(durationMs / 1000);
    if (this.requestDurationSeconds.length > 10_000) this.requestDurationSeconds.shift();
  }

  render() {
    const lines = [
      '# HELP beacon_stream_uptime_seconds Process uptime in seconds.',
      '# TYPE beacon_stream_uptime_seconds gauge',
      `beacon_stream_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`,
      '# HELP beacon_stream_http_requests_total HTTP requests handled by stable route and status.',
      '# TYPE beacon_stream_http_requests_total counter',
    ];
    for (const [key, count] of [...this.requests.entries()].sort()) {
      const [route, status] = key.split('|');
      lines.push(`beacon_stream_http_requests_total{route="${route}",status="${status}"} ${count}`);
    }
    const values = [...this.requestDurationSeconds].sort((a, b) => a - b);
    const quantile = (q) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * q))] : 0;
    lines.push(
      '# HELP beacon_stream_http_request_duration_seconds Recent in-process request duration estimates.',
      '# TYPE beacon_stream_http_request_duration_seconds gauge',
      `beacon_stream_http_request_duration_seconds{quantile="0.95"} ${quantile(0.95)}`,
      `beacon_stream_http_request_duration_seconds{quantile="0.99"} ${quantile(0.99)}`,
      '# HELP beacon_stream_bytes_served_total Authenticated segment bytes served.',
      '# TYPE beacon_stream_bytes_served_total counter',
      `beacon_stream_bytes_served_total ${this.bytesServed}`,
    );
    return `${lines.join('\n')}\n`;
  }
}
