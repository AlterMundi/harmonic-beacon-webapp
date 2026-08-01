#!/usr/bin/env python3
"""Independent Python verification of Beacon's RFC 8785 fixture domain."""

import hashlib
import hmac
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "contracts/commerce-entitlement/v1/canonicalization.fixture.json"
MANIFEST = FIXTURE.parent / "SHA256SUMS"
DERIVATION_FIXTURE = FIXTURE.parent / "credential-derivation.fixture.json"
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


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


def human_base32(value: bytes) -> str:
    accumulator = 0
    bits = 0
    output = []
    for byte in value:
        accumulator = (accumulator << 8) | byte
        bits += 8
        while bits >= 5:
            output.append(ALPHABET[(accumulator >> (bits - 5)) & 31])
            bits -= 5
            accumulator &= (1 << bits) - 1
    if bits:
        output.append(ALPHABET[(accumulator << (5 - bits)) & 31])
    return "".join(output)


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
    derivation = json.loads(DERIVATION_FIXTURE.read_text(encoding="utf-8"))
    material_bytes = f'{derivation["grant_id"]}|{derivation["generation"]}'.encode("utf-8")
    full_hmac = hmac.new(
        derivation["secret_utf8"].encode("utf-8"),
        material_bytes,
        hashlib.sha256,
    ).digest()
    encoded = human_base32(full_hmac[:20])
    code = "HB1-" + "-".join(encoded[index:index + 4] for index in range(0, 32, 4))
    if material_bytes.decode("utf-8") != derivation["material_utf8"]:
        raise SystemExit("credential material fixture mismatch")
    if full_hmac.hex() != derivation["hmac_sha256_hex"]:
        raise SystemExit("credential HMAC fixture mismatch")
    if full_hmac[:20].hex() != derivation["truncated_160_bits_hex"]:
        raise SystemExit("credential truncation fixture mismatch")
    if derivation["alphabet"] != ALPHABET or encoded != derivation["unprefixed_base32"]:
        raise SystemExit("credential Base32 fixture mismatch")
    if code != derivation["code"]:
        raise SystemExit("credential code fixture mismatch")
    print(f"commerce contract fixtures OK: command={digest} credential={code[-4:]}")


if __name__ == "__main__":
    main()
