#!/usr/bin/env python3
"""Independent Python verification of Beacon's RFC 8785 fixture domain."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "contracts/commerce-entitlement/v1/canonicalization.fixture.json"
MANIFEST = FIXTURE.parent / "SHA256SUMS"


def material(command: dict) -> dict:
    fields = (
        "schema_version", "source", "provider", "provision_revision",
        "desired_provider_state", "reason_code", "external_order_id",
        "external_ticket_id", "registration_id", "scheduled_session_id",
        "bound_email", "tier", "provider_observed_at", "grant",
    )
    projected = {key: command[key] for key in fields}
    projected["bound_email"] = projected["bound_email"].strip().lower()
    return projected


def main() -> None:
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        expected, filename = line.split("  ", 1)
        actual = hashlib.sha256((MANIFEST.parent / filename).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit(f"contract file hash mismatch: {filename}")
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    canonical = json.dumps(
        material(fixture["input"]),
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    if canonical != fixture["canonical_utf8"]:
        raise SystemExit("canonical UTF-8 fixture mismatch")
    if digest != fixture["sha256"]:
        raise SystemExit("SHA-256 fixture mismatch")
    print(f"commerce contract fixture OK: {digest}")


if __name__ == "__main__":
    main()
