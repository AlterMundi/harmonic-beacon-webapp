#!/usr/bin/python3
"""Call the existing Staff API over an operator's configured SSH route."""
import json
from pathlib import Path
import subprocess
import sys
import urllib.request


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ('staging', 'production'):
        raise ValueError('Usage: beacon-ops staging|production METHOD /api/ops/path; optional JSON body on stdin')
    environment, method, api_path = sys.argv[1:]
    config = json.loads((Path.home() / '.config/harmonic-beacon/operator.json').read_text())
    target = config['sshTarget']
    if not isinstance(target, str) or not target or target.startswith('-'):
        raise ValueError('Configured SSH target required')
    origin = 'https://live.harmonicbeacon.com' if environment == 'production' else 'https://live-staging.harmonicbeacon.com'
    with urllib.request.urlopen(origin + '/api/health', timeout=10) as response:
        health = json.loads(response.read(65536))
    request = {'expectedSourceSha': health['gitSha'], 'method': method, 'apiPath': api_path}
    if not sys.stdin.isatty():
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536: raise ValueError('Body exceeds bound')
        if raw.strip(): request['body'] = json.loads(raw)
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target,
        'sudo', '-n', '/usr/local/sbin/hb-operator-access', environment],
        input=json.dumps(request).encode(), timeout=120, check=False)
    return result.returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print('Beacon Staff API stopped: ' + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
