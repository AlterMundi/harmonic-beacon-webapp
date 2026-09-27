#!/usr/bin/env python3
"""Fixed read-only Mona probes; publish bounded metrics for shared alerting."""
import datetime as dt
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request

METRICS = Path('/var/lib/harmonic-beacon/metrics/platform-observer.prom')
ENDPOINTS = {
    'live': 'https://live.harmonicbeacon.com/api/health/ready',
    'account': 'https://account.harmonicbeacon.com/api/account/health/ready',
    'listen': 'https://listen.harmonicbeacon.com/api/health/ready',
}
BACKUPS = {
    'live': ('/mnt/beacon-data/backups/live/postgres', '*.dump'),
    'account': ('/mnt/beacon-data/backups/account', '*.dump.enc'),
    'analytics': ('/mnt/beacon-data/backups/analytics/postgres', '*.dump.age'),
    'commerce-authority': ('/mnt/beacon-data/backups/pmp-myth/encrypted', '*.tar.zst.age'),
}
UNITS = {
    'analytics': 'hb-analytics-monitor.service',
    'commerce-authority': 'pmp-myth-monitor.service',
}
EVENT_SQL = """BEGIN READ ONLY;
SET LOCAL statement_timeout = '3000ms';
SELECT json_build_object(
 'overdue',count(*) FILTER (WHERE status='SCHEDULED' AND scheduled_at<now() AND public_access AND is_published AND NOT is_test),
 'next',coalesce(extract(epoch FROM min(scheduled_at) FILTER (WHERE status='SCHEDULED' AND scheduled_at>=now() AND public_access AND is_published AND NOT is_test)),0),
 'live',count(*) FILTER (WHERE status='LIVE' AND NOT is_test))
FROM scheduled_sessions;
COMMIT;
"""


def command(args, input=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True,
                            timeout=8, check=True,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'DOCKER_CONFIG': '/nonexistent', 'TZ': 'UTC', 'LC_ALL': 'C'})
    if len(result.stdout) > 65536:
        raise ValueError('oversized probe output')
    return result.stdout


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_health(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(url, timeout=5) as response:
        body = response.read(65537)
        if len(body) > 65536 or response.status != 200:
            return 0
        value = json.loads(body)
        return int(value.get('status') in ('ok', 'healthy', 'ready'))


def backup_time(directory, pattern):
    path = Path(directory)
    if not Path('/mnt/beacon-data').is_mount() or path.is_symlink():
        raise ValueError('backup storage unavailable')
    # Timestamp is artifact freshness only; not a claim of successful restore.
    entries = list(path.iterdir())  # Permission errors must not become an empty backup set.
    if len(entries) > 10000:
        raise ValueError('unbounded backup directory')
    times = [f.stat().st_mtime for f in entries
             if f.match(pattern) and not f.is_symlink() and f.is_file() and f.stat().st_size > 0]
    return max(times, default=0)


def unit_health(unit):
    raw = command(['/usr/bin/systemctl', 'show', unit, '--property=LoadState,Result,ExecMainStatus,ExecMainExitTimestamp'])
    fields = dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)
    stamp = fields.get('ExecMainExitTimestamp', '')
    observed = dt.datetime.strptime(stamp, '%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc).timestamp()
    return int(fields.get('LoadState') == 'loaded' and fields.get('Result') == 'success'
               and fields.get('ExecMainStatus') == '0'), observed


def event_state():
    identity = command(['/usr/bin/docker', 'inspect', 'beacon-postgres', '--format',
                        '{{index .Config.Labels "com.docker.compose.project"}}:{{index .Config.Labels "com.docker.compose.service"}}'])
    if identity.strip() != 'app:postgres':
        raise ValueError('unexpected Live database target')
    raw = command(['/usr/bin/docker', 'exec', '-i', 'beacon-postgres', 'sh', '-c',
                   'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], EVENT_SQL)
    result = json.loads(raw)
    if set(result) != {'overdue', 'next', 'live'} or any(
        isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0
        for v in result.values()
    ):
        raise ValueError('invalid aggregate event probe')
    return result


def collect():
    values = []
    def metric(name, service, value):
        values.append(f'beacon_platform_{name}{{service="{service}"}} {value}')
    for service, url in ENDPOINTS.items():
        try:
            healthy = http_health(url)
        except Exception:
            healthy = 0
        metric('health_up', service, healthy)
    for service, (directory, pattern) in BACKUPS.items():
        try:
            observed = backup_time(directory, pattern)
            available = 1
        except Exception:
            observed, available = 0, 0
        metric('backup_probe_up', service, available)
        metric('backup_artifact_timestamp_seconds', service, observed)
    for service, unit in {'analytics': 'hb-analytics-backup.service', 'commerce-authority': 'pmp-myth-backup.service'}.items():
        try:
            healthy, _ = unit_health(unit)
        except Exception:
            healthy = 0
        metric('backup_job_up', service, healthy)
    for service, unit in UNITS.items():
        try:
            healthy, observed = unit_health(unit)
        except Exception:
            healthy, observed = 0, 0
        metric('monitor_up', service, healthy)
        metric('monitor_timestamp_seconds', service, observed)
    try:
        events = event_state()
        metric('event_probe_up', 'live', 1)
        for key, value in events.items():
            metric('events_' + key, 'live', value)
    except Exception:
        metric('event_probe_up', 'live', 0)
    values.append(f'beacon_platform_observer_timestamp_seconds {time.time()}')
    return '\n'.join(values) + '\n'


def publish(text):
    if METRICS.is_symlink() or METRICS.parent.is_symlink():
        raise ValueError('unsafe metrics path')
    fd, name = tempfile.mkstemp(prefix='.platform-observer-', dir=METRICS.parent)
    try:
        with os.fdopen(fd, 'w') as target:
            target.write(text)
            target.flush()
            os.fsync(target.fileno())
            os.fchmod(target.fileno(), 0o644)
        os.replace(name, METRICS)
    finally:
        Path(name).unlink(missing_ok=True)


if __name__ == '__main__':
    import sys
    if len(sys.argv) != 1:
        raise SystemExit('No command-line arguments supported')
    publish(collect())
