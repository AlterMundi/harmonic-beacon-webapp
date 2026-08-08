#!/usr/bin/env python3
"""Verify byte-exact copies of the canonical EarlyBird contracts."""

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = (
    ROOT / "contracts/early-bird-authority/v1",
    ROOT / "contracts/early-bird-authority/v2",
    ROOT / "contracts/early-bird-checkout/v2",
    ROOT / "contracts/early-bird-membership/v1",
)


def main() -> None:
    verified = 0
    for directory in CONTRACTS:
        manifest = directory / "SHA256SUMS"
        for line in manifest.read_text(encoding="utf-8").splitlines():
            expected, filename = line.split("  ", 1)
            actual = hashlib.sha256((directory / filename).read_bytes()).hexdigest()
            if actual != expected:
                raise SystemExit(f"EarlyBird contract hash mismatch: {directory.name}/{filename}")
            verified += 1
    print(f"EarlyBird contracts byte-exact: {verified} files")


if __name__ == "__main__":
    main()
