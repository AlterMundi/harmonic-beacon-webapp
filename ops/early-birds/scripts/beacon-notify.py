#!/usr/bin/env python3
"""Submit bounded operational alerts to Mona's shared, loopback Alertmanager."""
import argparse
import datetime as dt
import json
import re
import urllib.error
import urllib.request

SERVICES = ("host", "live", "account", "listen", "analytics", "commerce-authority", "home", "ops")
ENDPOINT = "http://127.0.0.1:9093/api/v2/alerts"


def payload(args, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{2,79}", args.name):
        raise ValueError("name must be a stable identifier, 3–80 characters")
    if not 60 <= args.ttl <= 86400:
        raise ValueError("ttl must be between 60 and 86400 seconds")
    if not 1 <= len(args.summary) <= 400 or any(ord(c) < 32 for c in args.summary):
        raise ValueError("summary must be one line, 1–400 characters")
    # No arbitrary URLs, user identifiers or secret-bearing payloads in routing.
    if not re.fullmatch(r"[A-Za-z0-9_./#-]{1,160}", args.runbook):
        raise ValueError("runbook must be a repository path or stable runbook name")
    stamp = lambda value: value.isoformat().replace("+00:00", "Z")
    return [{
        "labels": {"alertname": args.name, "service": args.service,
                   "severity": args.severity, "environment": args.environment,
                   "host": "mona", "product": "harmonic-beacon"},
        "annotations": {"summary": args.summary, "runbook": args.runbook},
        "startsAt": stamp(now - dt.timedelta(seconds=1)),
        "endsAt": stamp(now if args.resolve else now + dt.timedelta(seconds=args.ttl)),
    }]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=SERVICES, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--severity", choices=("warning", "critical"), default="warning")
    parser.add_argument("--environment", choices=("production", "staging", "preview"), default="production")
    parser.add_argument("--summary", required=True, help="Operational summary only; no secrets or personal data")
    parser.add_argument("--runbook", default="ops/early-birds/runbook/README.md")
    parser.add_argument("--ttl", type=int, default=900, help="Refresh before expiry; expiry resolves the alert")
    parser.add_argument("--resolve", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        body = json.dumps(payload(args)).encode()
    except ValueError as error:
        parser.error(str(error))
    if args.dry_run:
        print(body.decode())
        return
    request = urllib.request.Request(ENDPOINT, body, {"Content-Type": "application/json"}, method="POST")
    # Do not let a shell's HTTP_PROXY redirect operational data off-host.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=5) as response:
            if response.status != 200:
                raise RuntimeError("Alertmanager rejected the alert")
    except (urllib.error.URLError, TimeoutError, RuntimeError):
        parser.exit(1, "Alertmanager submission failed; inspect the local service.\n")
    print("Alertmanager accepted the alert; this alone does not prove Telegram delivery.")


if __name__ == "__main__":
    main()
