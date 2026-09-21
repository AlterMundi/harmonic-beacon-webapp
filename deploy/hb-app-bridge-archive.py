#!/usr/bin/env python3
"""Extract a reviewed app-bridge tar without links, traversal or overwrite."""

from pathlib import Path, PurePosixPath
import os
import sys
import tarfile


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"hb-app-bridge-archive: {message}")


if len(sys.argv) != 4:
    fail("usage: archive destination expected-entry-count")

archive = Path(sys.argv[1])
destination = Path(sys.argv[2])
try:
    expected_entries = int(sys.argv[3])
except ValueError:
    fail("invalid entry count")

seen: set[str] = set()
total_bytes = 0
with tarfile.open(archive, mode="r:") as bundle:
    members = bundle.getmembers()
    if len(members) != expected_entries:
        fail("archive entry count mismatch")
    for member in members:
        path = PurePosixPath(member.name)
        if not member.name or path.is_absolute() or ".." in path.parts or "." in path.parts:
            fail("unsafe archive path")
        normalized = str(path)
        if normalized in seen:
            fail("duplicate archive path")
        seen.add(normalized)
        if not (member.isdir() or member.isfile()):
            fail("links and special archive entries are forbidden")
        if member.size < 0 or member.size > 32 * 1024 * 1024:
            fail("archive member exceeds size bound")
        total_bytes += member.size
        if total_bytes > 256 * 1024 * 1024:
            fail("expanded archive exceeds size bound")

    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    for member in members:
        target = destination.joinpath(*PurePosixPath(member.name).parts)
        if member.isdir():
            target.mkdir(mode=0o755, parents=True, exist_ok=True)
            continue
        target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        source = bundle.extractfile(member)
        if source is None:
            fail("regular archive member has no content")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(target, flags, 0o755 if member.mode & 0o111 else 0o644)
        with source, os.fdopen(descriptor, "wb") as output:
            while chunk := source.read(1024 * 1024):
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
