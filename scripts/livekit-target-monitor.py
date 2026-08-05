#!/usr/bin/env python3
"""Credential-free, target-local telemetry for synthetic LiveKit load runs."""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
SAFE_RUN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
BYTE_UNITS = {
    "b": 1,
    "kb": 1_000,
    "mb": 1_000_000,
    "gb": 1_000_000_000,
    "tb": 1_000_000_000_000,
    "kib": 1_024,
    "mib": 1_048_576,
    "gib": 1_073_741_824,
    "tib": 1_099_511_627_776,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def safe_name(value: str) -> str:
    if not SAFE_NAME.fullmatch(value):
        raise argparse.ArgumentTypeError("must be a safe container or interface name")
    return value


def safe_run_id(value: str) -> str:
    if not SAFE_RUN_ID.fullmatch(value):
        raise argparse.ArgumentTypeError("must be 3-64 lowercase alphanumeric or hyphen characters")
    return value


def loopback_health_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname not in LOOPBACK_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise argparse.ArgumentTypeError("health URL must be credential-free HTTP(S) on loopback")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture target-local, redacted telemetry during a synthetic LiveKit load run.",
    )
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--run-id", required=True, type=safe_run_id)
    parser.add_argument("--duration-seconds", required=True, type=positive_float)
    parser.add_argument("--interval-seconds", default=1.0, type=positive_float)
    parser.add_argument(
        "--health-url",
        default="http://127.0.0.1:3000/api/health/ready",
        type=loopback_health_url,
    )
    parser.add_argument("--container", action="append", required=True, type=safe_name)
    parser.add_argument("--network-interface", type=safe_name)
    args = parser.parse_args()
    if args.interval_seconds > args.duration_seconds:
        parser.error("interval must not exceed duration")
    if len(set(args.container)) != len(args.container):
        parser.error("container names must be unique")
    return args


def default_network_interface() -> str:
    candidates: list[tuple[int, str]] = []
    with open("/proc/net/route", encoding="utf-8") as routes:
        next(routes, None)
        for line in routes:
            fields = line.split()
            if len(fields) < 8 or fields[1] != "00000000":
                continue
            try:
                flags = int(fields[3], 16)
                metric = int(fields[6])
            except ValueError:
                continue
            if flags & 0x1:
                candidates.append((metric, fields[0]))
    if not candidates:
        raise RuntimeError("no default network interface found")
    return min(candidates)[1]


def read_cpu() -> tuple[int, int]:
    fields = Path("/proc/stat").read_text(encoding="utf-8").splitlines()[0].split()[1:]
    counters = [int(value) for value in fields]
    total = sum(counters)
    idle = counters[3] + (counters[4] if len(counters) > 4 else 0)
    return total, idle


def cpu_busy_percent(before: tuple[int, int] | None, after: tuple[int, int]) -> float | None:
    if before is None:
        return None
    total_delta = after[0] - before[0]
    idle_delta = after[1] - before[1]
    if total_delta <= 0:
        return None
    return round((1 - idle_delta / total_delta) * 100, 2)


def memory_available_bytes() -> int | None:
    match = re.search(
        r"^MemAvailable:\s+(\d+)\s+kB$",
        Path("/proc/meminfo").read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    return int(match.group(1)) * 1024 if match else None


def network_bytes(interface: str) -> tuple[int, int]:
    root = Path("/sys/class/net") / interface / "statistics"
    return (
        int((root / "rx_bytes").read_text(encoding="utf-8")),
        int((root / "tx_bytes").read_text(encoding="utf-8")),
    )


def parse_bytes(value: str) -> int | None:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([KMGT]?i?B)\s*", value, re.IGNORECASE)
    if not match:
        return None
    return round(float(match.group(1)) * BYTE_UNITS[match.group(2).lower()])


def parse_pair(value: str) -> tuple[int | None, int | None]:
    parts = value.split("/", 1)
    if len(parts) != 2:
        return None, None
    return parse_bytes(parts[0]), parse_bytes(parts[1])


def run_command(arguments: list[str]) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            arguments,
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
            env={
                "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
                "LC_ALL": "C",
            },
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def container_samples(names: list[str]) -> list[dict[str, object]]:
    stats_result = run_command(
        ["docker", "stats", "--no-stream", "--format", "{{json .}}", *names],
    )
    inspect_result = run_command(
        [
            "docker",
            "inspect",
            "--format",
            "{{.Name}}\t{{.RestartCount}}\t{{.State.Status}}\t{{.State.OOMKilled}}\t"
            "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
            *names,
        ],
    )
    if (
        stats_result is None
        or stats_result.returncode != 0
        or inspect_result is None
        or inspect_result.returncode != 0
    ):
        return [
            {"name": name, "available": False, "error": "docker-unavailable"}
            for name in names
        ]
    try:
        stats_by_name = {}
        for line in stats_result.stdout.splitlines():
            stats = json.loads(line)
            stats_by_name[str(stats["Name"])] = stats
        inspect_by_name = {}
        for line in inspect_result.stdout.splitlines():
            raw_name, restart_count, state, oom_killed, health = line.split("\t", 4)
            inspect_by_name[raw_name.removeprefix("/")] = (
                restart_count,
                state,
                oom_killed,
                health,
            )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return [
            {"name": name, "available": False, "error": "docker-output-invalid"}
            for name in names
        ]

    samples: list[dict[str, object]] = []
    for name in names:
        try:
            stats = stats_by_name[name]
            restart_count, state, oom_killed, health = inspect_by_name[name]
            memory_usage, memory_limit = parse_pair(stats.get("MemUsage", ""))
            network_rx, network_tx = parse_pair(stats.get("NetIO", ""))
            samples.append(
                {
                    "name": name,
                    "available": True,
                    "cpuPercent": float(str(stats.get("CPUPerc", "")).rstrip("%")),
                    "memoryUsageBytes": memory_usage,
                    "memoryLimitBytes": memory_limit,
                    "networkRxBytes": network_rx,
                    "networkTxBytes": network_tx,
                    "pids": int(stats.get("PIDs", 0)),
                    "restartCount": int(restart_count),
                    "state": state,
                    "oomKilled": oom_killed.lower() == "true",
                    "health": None if health == "none" else health,
                },
            )
        except (KeyError, TypeError, ValueError):
            samples.append(
                {"name": name, "available": False, "error": "docker-output-invalid"},
            )
    return samples


def health_sample(url: str, timeout: float) -> dict[str, object]:
    started = time.monotonic()
    request = urllib.request.Request(url, headers={"User-Agent": "harmonic-beacon-load-monitor/1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read(1)
            return {
                "ok": 200 <= response.status < 300,
                "status": response.status,
                "latencyMs": round((time.monotonic() - started) * 1000, 2),
            }
    except urllib.error.HTTPError as error:
        return {
            "ok": False,
            "status": error.code,
            "latencyMs": round((time.monotonic() - started) * 1000, 2),
            "error": "http",
        }
    except (TimeoutError, socket.timeout):
        return {
            "ok": False,
            "status": None,
            "latencyMs": round((time.monotonic() - started) * 1000, 2),
            "error": "timeout",
        }
    except (OSError, urllib.error.URLError):
        return {
            "ok": False,
            "status": None,
            "latencyMs": round((time.monotonic() - started) * 1000, 2),
            "error": "network",
        }


def write_record(output, record: dict[str, object]) -> None:
    output.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")
    output.flush()


def main() -> int:
    args = parse_args()
    interface = args.network_interface or default_network_interface()
    if not (Path("/sys/class/net") / interface).is_dir():
        raise RuntimeError("network interface does not exist")
    if args.output.exists():
        raise RuntimeError("refusing to overwrite an existing telemetry file")
    args.output.parent.mkdir(parents=True, exist_ok=True)

    stop = threading.Event()
    received_signal: str | None = None

    def request_stop(signum, _frame) -> None:
        nonlocal received_signal
        if received_signal is None:
            received_signal = signal.Signals(signum).name
            stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    started_at = utc_now()
    started = time.monotonic()
    deadline = started + args.duration_seconds
    next_sample_at = started
    previous_cpu: tuple[int, int] | None = None
    first_network: tuple[int, int] | None = None
    last_network: tuple[int, int] | None = None
    sample_count = 0
    health_failures = 0
    max_health_latency = 0.0
    max_collection_ms = 0.0
    max_cpu_busy: float | None = None
    min_memory_available: int | None = None
    container_max_cpu = {name: 0.0 for name in args.container}
    container_first_restarts: dict[str, int] = {}
    container_last_restarts: dict[str, int] = {}
    oom_observed = False

    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        write_record(
            output,
            {
                "schemaVersion": 1,
                "kind": "harmonic-beacon-livekit-target-monitor",
                "recordType": "header",
                "runId": args.run_id,
                "startedAt": started_at,
                "durationSeconds": args.duration_seconds,
                "intervalSeconds": args.interval_seconds,
                "healthTarget": "loopback",
                "networkInterface": interface,
                "containers": args.container,
            },
        )
        while not stop.is_set():
            sample_started = time.monotonic()
            cpu = read_cpu()
            memory = memory_available_bytes()
            network = network_bytes(interface)
            if first_network is None:
                first_network = network
            last_network = network
            busy = cpu_busy_percent(previous_cpu, cpu)
            previous_cpu = cpu
            health = health_sample(args.health_url, timeout=min(5.0, args.interval_seconds))
            containers = container_samples(args.container)
            sample_count += 1
            if not health["ok"]:
                health_failures += 1
            max_health_latency = max(max_health_latency, float(health["latencyMs"]))
            if busy is not None:
                max_cpu_busy = busy if max_cpu_busy is None else max(max_cpu_busy, busy)
            if memory is not None:
                min_memory_available = (
                    memory if min_memory_available is None else min(min_memory_available, memory)
                )
            for container in containers:
                if not container.get("available"):
                    continue
                name = str(container["name"])
                container_max_cpu[name] = max(
                    container_max_cpu[name],
                    float(container["cpuPercent"]),
                )
                restarts = int(container["restartCount"])
                container_first_restarts.setdefault(name, restarts)
                container_last_restarts[name] = restarts
                oom_observed = oom_observed or bool(container["oomKilled"])
            collection_ms = round((time.monotonic() - sample_started) * 1000, 2)
            max_collection_ms = max(max_collection_ms, collection_ms)
            write_record(
                output,
                {
                    "recordType": "sample",
                    "at": utc_now(),
                    "elapsedMs": round((time.monotonic() - started) * 1000),
                    "collectionMs": collection_ms,
                    "host": {
                        "cpuBusyPercent": busy,
                        "memoryAvailableBytes": memory,
                        "load1": round(os.getloadavg()[0], 3),
                        "networkRxBytes": network[0],
                        "networkTxBytes": network[1],
                    },
                    "health": health,
                    "containers": containers,
                },
            )
            if time.monotonic() >= deadline:
                break
            next_sample_at += args.interval_seconds
            stop.wait(max(0.0, min(next_sample_at, deadline) - time.monotonic()))

        restart_deltas = {
            name: container_last_restarts.get(name, first) - first
            for name, first in container_first_restarts.items()
        }
        write_record(
            output,
            {
                "recordType": "summary",
                "endedAt": utc_now(),
                "samples": sample_count,
                "interrupted": received_signal is not None,
                "signal": received_signal,
                "healthFailures": health_failures,
                "maxHealthLatencyMs": round(max_health_latency, 2),
                "maxCollectionMs": round(max_collection_ms, 2),
                "maxHostCpuBusyPercent": max_cpu_busy,
                "minMemoryAvailableBytes": min_memory_available,
                "networkRxBytesDelta": (
                    last_network[0] - first_network[0] if first_network and last_network else None
                ),
                "networkTxBytesDelta": (
                    last_network[1] - first_network[1] if first_network and last_network else None
                ),
                "containerMaxCpuPercent": container_max_cpu,
                "containerRestartDelta": restart_deltas,
                "oomObserved": oom_observed,
            },
        )
        os.fsync(output.fileno())

    if received_signal == "SIGINT":
        return 130
    if received_signal == "SIGTERM":
        return 143
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"target monitor refused or failed: {error}", file=sys.stderr)
        raise SystemExit(1)
