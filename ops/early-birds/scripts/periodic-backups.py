#!/usr/bin/env python3
"""Fixed production PostgreSQL backups, encrypted on the separate data disk."""
import contextlib
import datetime as dt
import fcntl
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path('/mnt/beacon-data/backups/platform')
RECIPIENTS = Path('/etc/harmonic-beacon/analytics-backup-recipients.txt')
IDENTITY = Path('/etc/harmonic-beacon/analytics-backup-identity.txt')
PG_IMAGE = 'postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'
TARGETS = {'live': ('beacon-postgres', 'app:postgres'),
           'account': ('earlybirds-preview-postgres-1', 'earlybirds-preview:postgres')}
LOCKS = ['/var/lib/harmonic-beacon/app-bridge/operation.lock',
         '/var/lib/harmonic-beacon/account-delivery/.delivery-production.lock']


def run(args, **kwargs):
    return subprocess.run(args, check=True, stderr=subprocess.PIPE, timeout=300,
                          env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
                               'DOCKER_CONFIG': '/var/lib/harmonic-beacon/storage-maintenance/docker-config'},
                          **kwargs)


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def sync(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def regular(path):
    st = path.lstat()
    if path.is_symlink() or not path.is_file() or st.st_nlink != 1 or st.st_uid != 0:
        raise RuntimeError('unsafe backup input')
    return st


def retain(directory, service, now):
    pattern = re.compile(r'periodic-' + re.escape(service) + r'-\d{8}T\d{6}Z\.dump\.age')
    files = sorted((p for p in directory.iterdir() if pattern.fullmatch(p.name)),
                   key=lambda p: p.lstat().st_mtime, reverse=True)
    for path in files[3:]:
        if now - regular(path).st_mtime <= 14 * 86400:
            continue
        sidecar = path.with_name(path.name + '.sha256')
        regular(sidecar)
        if sidecar.read_text() != f'{checksum(path)}  {path.name}\n':
            raise RuntimeError('refusing retention of unverified backup')
        path.unlink()
        sidecar.unlink()
    sync(directory)


def backup(service, container, identity):
    directory = ROOT / service
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_uid != 0 or directory.stat().st_mode & 0o077:
        raise RuntimeError('unsafe backup directory')
    if shutil.disk_usage(ROOT).free < 10 * 1024**3:
        raise RuntimeError('backup storage reserve exhausted')
    observed = run(['docker', 'inspect', container, '--format',
                    '{{index .Config.Labels "com.docker.compose.project"}}:{{index .Config.Labels "com.docker.compose.service"}}'],
                   stdout=subprocess.PIPE).stdout.decode().strip()
    if observed != identity:
        raise RuntimeError('unexpected database target')
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    name = f'periodic-{service}-{stamp}.dump.age'
    destination = directory / name
    if destination.exists():
        raise RuntimeError('backup already exists')
    with tempfile.TemporaryDirectory(prefix='.stage-', dir=directory) as temporary:
        stage = Path(temporary)
        plain, encrypted, restored = stage/'database.dump', stage/name, stage/'verified.dump'
        with plain.open('xb') as output:
            run(['docker', 'exec', container, 'sh', '-ec',
                 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges'], stdout=output)
        if plain.stat().st_size == 0:
            raise RuntimeError('empty backup')
        run(['age', '-R', str(RECIPIENTS), '-o', str(encrypted), str(plain)])
        run(['age', '-d', '-i', str(IDENTITY), '-o', str(restored), str(encrypted)])
        if checksum(plain) != checksum(restored):
            raise RuntimeError('encrypted backup roundtrip mismatch')
        with restored.open('rb') as source:
            run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '-i',
                 PG_IMAGE, 'pg_restore', '--list'], stdin=source, stdout=subprocess.DEVNULL)
        sidecar = stage/(name+'.sha256')
        sidecar.write_text(f'{checksum(encrypted)}  {name}\n')
        sync(encrypted)
        sync(sidecar)
        os.rename(encrypted, destination)
        os.rename(sidecar, directory/sidecar.name)
        sync(directory)
    retain(directory, service, time.time())
    print(f'{service}: encrypted production backup verified and published', flush=True)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('root required')
    os.umask(0o077)
    mount = Path('/mnt/beacon-data')
    if not mount.is_mount() or mount.stat().st_dev == Path('/').stat().st_dev:
        raise RuntimeError('separate backup mount missing')
    for key in (RECIPIENTS, IDENTITY):
        if regular(key).st_mode & 0o077:
            raise RuntimeError('unsafe encryption material permissions')
    recipients = [line for line in RECIPIENTS.read_text().splitlines() if line.startswith('age1')]
    if len(set(recipients)) != 2:
        raise RuntimeError('two recovery recipients required')
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    for ancestor in (ROOT, ROOT.parent):
        if ancestor.is_symlink() or ancestor.stat().st_uid != 0:
            raise RuntimeError('unsafe backup root')
    with contextlib.ExitStack() as stack:
        for path in ['/run/lock/harmonic-beacon-periodic-backups.lock', *LOCKS]:
            fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            stack.callback(os.close, fd)
            if os.fstat(fd).st_uid != 0 or os.fstat(fd).st_nlink != 1:
                raise RuntimeError('unsafe backup lock')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for service, (container, identity) in TARGETS.items():
            backup(service, container, identity)


if __name__ == '__main__':
    import sys
    try:
        if len(sys.argv) != 1:
            raise RuntimeError('arguments unsupported')
        main()
    except Exception as error:
        # Subprocess stderr can contain database details; never send it to logs.
        print(f'periodic backup failed: {type(error).__name__}', file=sys.stderr)
        raise SystemExit(1)
