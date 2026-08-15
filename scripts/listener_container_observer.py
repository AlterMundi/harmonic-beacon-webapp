#!/usr/bin/python3
"""Export fixed Listener container restart/OOM continuity as textfile metrics."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys
import time
from typing import Any

OBSERVER_SCHEMA_VERSION = 1
DOCKER_BINARY = "/usr/bin/docker"
METRICS_FILE = Path("/var/lib/harmonic-beacon/metrics/listener-container-observer.prom")
STATE_FILE = Path("/var/lib/harmonic-beacon/listener-container-observer/state.json")
MAX_INSPECT_BYTES = 256 * 1024
MAX_STATE_BYTES = 64 * 1024
MAX_SAFE_COUNTER = (2**53) - 1

TARGETS = (
    {"role": "listener", "name": "earlybirds-preview-listener-1", "service": "listener"},
    {"role": "origin", "name": "earlybirds-preview-beacon-stream-1", "service": "beacon-stream"},
)


def _bounded_counter(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_SAFE_COUNTER:
        raise ValueError(f"{label} is invalid")
    return value


def _timestamp(value: Any, label: str) -> float:
    if not isinstance(value, str):
        raise ValueError(f"{label} is invalid")
    try:
        # Docker emits RFC3339 with nanoseconds and Z; fromisoformat accepts a
        # bounded microsecond form, so truncate only the fractional precision.
        normalized = value.replace("Z", "+00:00")
        if "." in normalized:
            prefix, suffix = normalized.split(".", 1)
            digits, zone = suffix.split("+", 1) if "+" in suffix else suffix.split("-", 1)
            sign = "+" if "+" in suffix else "-"
            normalized = f"{prefix}.{digits[:6]}{sign}{zone}"
        from datetime import datetime

        result = datetime.fromisoformat(normalized).timestamp()
    except (TypeError, ValueError):
        raise ValueError(f"{label} is invalid") from None
    if not result > 0:
        raise ValueError(f"{label} is invalid")
    return result


def _identity_digest(value: Any) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(ch not in "0123456789abcdef" for ch in value):
        raise ValueError("container identity is invalid")
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def parse_docker_inspect(raw: str) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > MAX_INSPECT_BYTES:
        raise ValueError("Docker inspect output is invalid")
    try:
        rows = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError("Docker inspect output is malformed") from None
    if not isinstance(rows, list) or len(rows) != len(TARGETS):
        raise ValueError("Docker inspect target set is incomplete or ambiguous")

    by_name: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = row.get("Name", "") if isinstance(row, dict) else ""
        name = name.removeprefix("/") if isinstance(name, str) else ""
        if not name or name in by_name:
            raise ValueError("Docker inspect target is duplicated")
        by_name[name] = row

    result: dict[str, dict[str, Any]] = {}
    for target in TARGETS:
        row = by_name.get(target["name"])
        labels = row.get("Config", {}).get("Labels", {}) if isinstance(row, dict) else {}
        if (
            not row
            or labels.get("com.docker.compose.project") != "earlybirds-preview"
            or labels.get("com.docker.compose.service") != target["service"]
        ):
            raise ValueError(f"Docker inspect {target['role']} target does not match its fixed boundary")
        state = row.get("State", {})
        if state.get("Status") != "running":
            raise ValueError(f"Docker inspect {target['role']} target is not running")
        result[target["role"]] = {
            "identity": _identity_digest(row.get("Id")),
            "startTimeSeconds": _timestamp(state.get("StartedAt"), f"{target['role']} start time"),
            "dockerRestartCount": _bounded_counter(
                row.get("RestartCount"), f"{target['role']} restart count"
            ),
            "oomKilled": state.get("OOMKilled") is True,
        }
    return result


def _validate_previous_target(value: Any, role: str) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("identity"), str)
        or len(value["identity"]) != 64
        or any(ch not in "0123456789abcdef" for ch in value["identity"])
        or isinstance(value.get("startTimeSeconds"), bool)
        or not isinstance(value.get("startTimeSeconds"), (int, float))
        or not isinstance(value.get("oomKilled"), bool)
    ):
        raise ValueError(f"observer {role} state is invalid")
    _bounded_counter(value.get("dockerRestartCount"), f"{role} stored Docker restart count")
    _bounded_counter(value.get("restartEventsTotal"), f"{role} stored restart total")
    _bounded_counter(value.get("oomEventsTotal"), f"{role} stored OOM total")
    return value


def _add_counter(left: int, right: int, label: str) -> int:
    return _bounded_counter(left + right, label)


def advance_observer_state(
    previous: dict[str, Any] | None,
    observations: dict[str, dict[str, Any]],
    observed_at_seconds: int,
) -> dict[str, Any]:
    if isinstance(observed_at_seconds, bool) or not isinstance(observed_at_seconds, int) or observed_at_seconds <= 0:
        raise ValueError("observer timestamp is invalid")
    first = previous is None
    if not first and (
        not isinstance(previous, dict)
        or previous.get("schemaVersion") != OBSERVER_SCHEMA_VERSION
        or isinstance(previous.get("epochStartedAtSeconds"), bool)
        or not isinstance(previous.get("epochStartedAtSeconds"), int)
        or previous["epochStartedAtSeconds"] <= 0
        or not isinstance(previous.get("targets"), dict)
    ):
        raise ValueError("observer state is invalid")

    next_targets: dict[str, dict[str, Any]] = {}
    for target in TARGETS:
        role = target["role"]
        observation = observations.get(role)
        if not isinstance(observation, dict):
            raise ValueError(f"observer {role} observation is missing")
        identity = observation.get("identity")
        if not isinstance(identity, str) or len(identity) != 64:
            raise ValueError(f"observer {role} observation is invalid")
        restart_count = _bounded_counter(observation.get("dockerRestartCount"), f"{role} restart count")
        start_time = observation.get("startTimeSeconds")
        if isinstance(start_time, bool) or not isinstance(start_time, (int, float)) or not start_time > 0:
            raise ValueError(f"observer {role} start time is invalid")
        oom_killed = observation.get("oomKilled") is True
        old = None if first else _validate_previous_target(previous["targets"].get(role), role)

        if old is None:
            restart_total = restart_count
            oom_total = 1 if oom_killed else 0
        elif old["identity"] != identity:
            restart_total = _add_counter(
                old["restartEventsTotal"], 1 + restart_count, f"{role} restart total"
            )
            oom_total = _add_counter(old["oomEventsTotal"], 1 if oom_killed else 0, f"{role} OOM total")
        else:
            if restart_count < old["dockerRestartCount"]:
                raise ValueError(f"observer {role} Docker restart counter moved backwards")
            restart_total = _add_counter(
                old["restartEventsTotal"], restart_count - old["dockerRestartCount"], f"{role} restart total"
            )
            oom_total = _add_counter(
                old["oomEventsTotal"], 1 if oom_killed and not old["oomKilled"] else 0, f"{role} OOM total"
            )

        next_targets[role] = {
            "identity": identity,
            "startTimeSeconds": start_time,
            "dockerRestartCount": restart_count,
            "restartEventsTotal": restart_total,
            "oomEventsTotal": oom_total,
            "oomKilled": oom_killed,
        }

    return {
        "schemaVersion": OBSERVER_SCHEMA_VERSION,
        "epochStartedAtSeconds": observed_at_seconds if first else previous["epochStartedAtSeconds"],
        "lastSuccessAtSeconds": observed_at_seconds,
        "targets": next_targets,
    }


def render_observer_metrics(state: dict[str, Any]) -> str:
    if not isinstance(state, dict) or state.get("schemaVersion") != OBSERVER_SCHEMA_VERSION:
        raise ValueError("observer metrics state is invalid")
    epoch = _bounded_counter(state.get("epochStartedAtSeconds"), "observer epoch")
    success = _bounded_counter(state.get("lastSuccessAtSeconds"), "observer success timestamp")
    lines = [
        "# HELP beacon_listener_container_observer_up Whether the fixed Listener container observer completed its latest sample.",
        "# TYPE beacon_listener_container_observer_up gauge",
        "beacon_listener_container_observer_up 1",
        "# HELP beacon_listener_container_observer_last_success_timestamp_seconds Unix time of the latest complete fixed-target sample.",
        "# TYPE beacon_listener_container_observer_last_success_timestamp_seconds gauge",
        f"beacon_listener_container_observer_last_success_timestamp_seconds {success}",
        "# HELP beacon_listener_container_observer_epoch_start_time_seconds Unix time at which the durable observer epoch began.",
        "# TYPE beacon_listener_container_observer_epoch_start_time_seconds gauge",
        f"beacon_listener_container_observer_epoch_start_time_seconds {epoch}",
        "# HELP beacon_listener_container_start_time_seconds Start time of the currently observed fixed container role.",
        "# TYPE beacon_listener_container_start_time_seconds gauge",
        "# HELP beacon_listener_container_restart_events_total Restarts or replacements observed for the fixed container role.",
        "# TYPE beacon_listener_container_restart_events_total counter",
        "# HELP beacon_listener_container_oom_events_total OOM-killed terminal states observed for the fixed container role.",
        "# TYPE beacon_listener_container_oom_events_total counter",
    ]
    for target in TARGETS:
        role = target["role"]
        value = _validate_previous_target(state.get("targets", {}).get(role), role)
        lines.extend(
            [
                f'beacon_listener_container_start_time_seconds{{role="{role}"}} {value["startTimeSeconds"]}',
                f'beacon_listener_container_restart_events_total{{role="{role}"}} {value["restartEventsTotal"]}',
                f'beacon_listener_container_oom_events_total{{role="{role}"}} {value["oomEventsTotal"]}',
            ]
        )
    return "\n".join(lines) + "\n"


def render_observer_failure_metrics(observed_at_seconds: int) -> str:
    failure = _bounded_counter(observed_at_seconds, "observer failure timestamp")
    return "\n".join(
        [
            "# HELP beacon_listener_container_observer_up Whether the fixed Listener container observer completed its latest sample.",
            "# TYPE beacon_listener_container_observer_up gauge",
            "beacon_listener_container_observer_up 0",
            "# HELP beacon_listener_container_observer_last_failure_timestamp_seconds Unix time of the latest failed sample.",
            "# TYPE beacon_listener_container_observer_last_failure_timestamp_seconds gauge",
            f"beacon_listener_container_observer_last_failure_timestamp_seconds {failure}",
            "",
        ]
    )


def _ensure_root_directory(path: Path, mode: int) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=mode)
    details = path.lstat()
    if not stat.S_ISDIR(details.st_mode) or details.st_uid != 0 or details.st_mode & 0o022:
        raise RuntimeError("observer output directory is unsafe")
    path.chmod(mode)


def _atomic_write(path: Path, contents: str, mode: int) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(6)}.tmp")
    descriptor = None
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            descriptor = None
            output.write(contents)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode, follow_symlinks=False)
        os.replace(temporary, path)
        directory_descriptor = os.open(
            path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        )
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _read_state() -> dict[str, Any] | None:
    try:
        details = STATE_FILE.lstat()
    except FileNotFoundError:
        return None
    if (
        not stat.S_ISREG(details.st_mode)
        or details.st_uid != 0
        or stat.S_IMODE(details.st_mode) != 0o600
        or details.st_size > MAX_STATE_BYTES
    ):
        raise RuntimeError("observer state cannot be read safely")
    descriptor = os.open(STATE_FILE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        with os.fdopen(descriptor, "r", encoding="utf-8") as source:
            descriptor = -1
            value = json.load(source)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise RuntimeError("observer state cannot be read safely") from None
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    return value


def _write_failure_best_effort(observed_at_seconds: int) -> None:
    try:
        _ensure_root_directory(METRICS_FILE.parent, 0o755)
        _atomic_write(METRICS_FILE, render_observer_failure_metrics(observed_at_seconds), 0o644)
    except Exception:
        pass


def run_observer() -> None:
    if len(sys.argv) != 1:
        raise RuntimeError("observer accepts no arguments")
    if os.geteuid() != 0:
        raise RuntimeError("observer requires root")
    observed_at_seconds = int(time.time())
    _ensure_root_directory(METRICS_FILE.parent, 0o755)
    _ensure_root_directory(STATE_FILE.parent, 0o700)
    try:
        completed = subprocess.run(
            [
                DOCKER_BINARY,
                "--host=unix:///var/run/docker.sock",
                "inspect",
                *(target["name"] for target in TARGETS),
            ],
            check=True,
            capture_output=True,
            env={
                "DOCKER_CONFIG": "/nonexistent",
                "HOME": "/nonexistent",
                "LANG": "C",
                "LC_ALL": "C",
                "PATH": "/usr/bin:/bin",
            },
            text=True,
            timeout=5,
        )
        if len(completed.stdout.encode("utf-8")) > MAX_INSPECT_BYTES:
            raise RuntimeError("Docker inspect output is oversized")
        state = advance_observer_state(
            _read_state(), parse_docker_inspect(completed.stdout), observed_at_seconds
        )
        _atomic_write(STATE_FILE, json.dumps(state, separators=(",", ":")) + "\n", 0o600)
        _atomic_write(METRICS_FILE, render_observer_metrics(state), 0o644)
    except Exception:
        _write_failure_best_effort(observed_at_seconds)
        raise


if __name__ == "__main__":
    try:
        run_observer()
    except Exception as error:
        print(f"Listener container observer failed closed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
