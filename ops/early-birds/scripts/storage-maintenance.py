#!/usr/bin/env python3
"""Bounded Mona image/cache retention. Default is a read-only plan."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import time

ARCHIVES = Path('/mnt/beacon-data/archives/runtime-images')
STATE = Path('/var/lib/harmonic-beacon/storage-maintenance')
METRICS = Path('/var/lib/harmonic-beacon/metrics/storage-maintenance.prom')
DELIVERY_STATE = Path('/var/lib/harmonic-beacon')
REPOSITORIES = {
    'harmonic-beacon/account', 'harmonic-beacon/live', 'harmonic-beacon/live-staging',
    'harmonic-beacon/app', 'harmonic-beacon/tapestry', 'harmonic-beacon/tapestry-staging',
    'harmonic-beacon/playlist-staging', 'harmonic-beacon/playlist-bot',
    'harmonic-beacon/listener-identity-staging', 'harmonic-beacon/earlybirds-preview-listener',
    'harmonic-beacon/analytics',
}
# Existing deployment locks: do not collect while a service is changing target.
LOCKS = [
    '/var/lib/harmonic-beacon/app-bridge/operation.lock',
    '/var/lib/harmonic-beacon/account-delivery/.delivery-production.lock',
    '/var/lib/harmonic-beacon/account-delivery/.delivery-staging.lock',
    '/var/lib/harmonic-beacon/listener-delivery/operation.lock',
    '/run/lock/beacon-account-production.lock', '/run/lock/beacon-account-staging.lock',
    '/run/lock/listener-account-production.lock', '/run/lock/listener-identity-staging.lock',
    '/run/lock/live-account-production.lock',
]
TARGET_FREE = 0.35
KEEP_IMAGES = 3
MIN_IMAGE_AGE = 3 * 86400
MAX_IMAGES_PER_RUN = 2
MAX_ARCHIVE_AGE = 30 * 86400
MIN_ARCHIVE_AGE = 7 * 86400
ARCHIVE_BUDGET = 20 * 1024**3
DATA_RESERVE = 10 * 1024**3


def run(*args, timeout=30):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=timeout,
                                   env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
                                        'DOCKER_CONFIG': '/nonexistent', 'LC_ALL': 'C'})


def inventory():
    ids = sorted(set(run('docker', 'image', 'ls', '-aq', '--no-trunc').split()))
    images = json.loads(run('docker', 'image', 'inspect', *ids)) if ids else []
    cids = run('docker', 'ps', '-aq').split()
    # Read only image bindings/running state, never container environment.
    bindings = [json.loads(line) for line in run('docker', 'inspect', '--format',
        '{"id":{{json .Image}},"ref":{{json .Config.Image}},"running":{{json .State.Running}}}',
        *cids).splitlines()] if cids else []
    used = {b['id'] for b in bindings}
    running = {b['id'] for b in bindings if b['running']}
    missing = used - {i['Id'] for i in images}
    for image_id in missing:
        # A pre-existing container can outlive its image-store metadata. Protect
        # its namespace too; it is not an available recovery artifact.
        refs = sorted({b['ref'] for b in bindings if b['id'] == image_id and
                       not b['ref'].startswith('sha256:')})
        images.append({'Id': image_id, 'RepoTags': refs, 'Created': '1970-01-01T00:00:00Z',
                       'Size': 0, 'Unavailable': True})
    for image in images:
        image['Running'] = image['Id'] in running
    return images, used


def created(image):
    # Docker timestamps may contain nanoseconds; ISO parser accepts/truncates them.
    return dt.datetime.fromisoformat(image['Created'].replace('Z', '+00:00')).timestamp()


def rollback_protection(images, used):
    """Resolve rollback refs from delivery evidence, not image creation order."""
    by_tag = {tag: image['Id'] for image in images if not image.get('Unavailable')
              for tag in image.get('RepoTags') or []}
    protected = set()
    covered = set()
    account_states = (DELIVERY_STATE/'account-delivery').glob('*.json')
    for path in account_states:
        value = json.loads(path.read_text())
        if value.get('candidate_image_id') not in used:
            continue
        previous = value.get('previous_sha')
        if previous and re.fullmatch('[a-f0-9]{40}', previous):
            ref = 'harmonic-beacon/account:'+previous
            if ref not in by_tag:
                raise RuntimeError('Account rollback image missing')
            protected.add(by_tag[ref])
            covered.add(value['candidate_image_id'])
    root = DELIVERY_STATE/'listener-account-production'
    pointer = root/'last-activation'
    if pointer.exists():
        activation = Path(pointer.read_text().strip())
        if activation.parent != root or activation.is_symlink():
            raise RuntimeError('invalid Listener activation pointer')
        candidate = (activation/'candidate-image.txt').read_text().strip()
        previous = (activation/'previous-image.txt').read_text().strip()
        if by_tag.get(candidate) in used:
            if previous not in by_tag:
                raise RuntimeError('Listener rollback image missing')
            protected.add(by_tag[previous])
            covered.add(by_tag[candidate])
    root = DELIVERY_STATE/'listener-identity-staging'
    if (root/'current-image').is_file() and (root/'previous-image').is_file():
        candidate = (root/'current-image').read_text().strip()
        previous = (root/'previous-image').read_text().strip()
        if by_tag.get(candidate) in used:
            if previous not in by_tag:
                raise RuntimeError('Listener staging rollback image missing')
            protected.add(by_tag[previous])
            covered.add(by_tag[candidate])
    for target in ('production', 'staging'):
        root = DELIVERY_STATE/'media-release-590'/target
        if not (root/'state.json').is_file():
            continue
        state = json.loads((root/'state.json').read_text())
        if state.get('phase') != 'applied':
            continue
        prior = json.loads((root/'prior.json').read_text())
        for service, image_id in state['targets'].items():
            if image_id in used:
                previous = prior[service]['Image']
                # Inspect the exact ID even if Docker's tag listing omits it.
                if previous not in {i['Id'] for i in images}:
                    raise RuntimeError('Live media rollback image missing')
                protected.add(previous)
                covered.add(image_id)
    supported = set()
    for repo in REPOSITORIES:
        active = {i['Id'] for i in images if i.get('Running') and
                  any(t.rsplit(':', 1)[0] == repo for t in i.get('RepoTags') or [])}
        if active and active.issubset(covered):
            supported.add(repo)
    # Repositories without authoritative rollback bindings remain protected.
    for image in images:
        repos = {tag.rsplit(':', 1)[0] for tag in image.get('RepoTags') or []}
        if not repos.issubset(supported):
            protected.add(image['Id'])
    return protected


def selection(images, used, now, rollback_ids=None):
    protected = set(used) | (rollback_protection(images, used) if rollback_ids is None else set(rollback_ids))
    groups = {repo: [] for repo in REPOSITORIES}
    for image in images:
        tags = image.get('RepoTags') or []
        repos = {tag.rsplit(':', 1)[0] for tag in tags}
        if (not tags or not repos.issubset(REPOSITORIES)
                or any(not re.fullmatch('[a-f0-9]{7}|[a-f0-9]{40}', t.rsplit(':', 1)[1]) for t in tags)):
            protected.add(image['Id'])
        for repo in repos.intersection(REPOSITORIES):
            groups[repo].append(image)
    for members in groups.values():
        protected.update(i['Id'] for i in sorted(members, key=created, reverse=True)[:KEEP_IMAGES])
    eligible = [i for i in images if i['Id'] not in protected and now-created(i) >= MIN_IMAGE_AGE]
    return sorted(eligible, key=created), protected


def free_ratio():
    usage = os.statvfs('/')
    return usage.f_bavail / usage.f_blocks


def cache_cleanup():
    # Shared cache contains image-backed layers; never select it here.
    age = '24h' if free_ratio() < 0.20 else '72h'
    records = [json.loads(line) for line in run('docker', 'buildx', 'du', '--filter', 'until='+age,
                                               '--format', 'json').splitlines()]
    selected = [r['ID'] for r in records if r.get('Reclaimable') and not r.get('Shared')
                and re.fullmatch('[a-z0-9]+', r['ID'])]
    if not selected:
        return 0
    selector = 'id~=^('+'|'.join(selected)+')$'
    check = [json.loads(line) for line in run('docker', 'buildx', 'du', '--filter', selector,
                                            '--filter', 'until='+age, '--format', 'json').splitlines()]
    if {r['ID'] for r in check} != set(selected) or not all(r['Reclaimable'] and not r['Shared'] for r in check):
        raise RuntimeError('cache inventory changed')
    before = set(run('docker', 'image', 'ls', '-aq', '--no-trunc').split())
    run('docker', 'buildx', 'prune', '--filter', selector, '--filter', 'until='+age, '--force', timeout=600)
    if before != set(run('docker', 'image', 'ls', '-aq', '--no-trunc').split()):
        raise RuntimeError('image inventory changed during cache cleanup')
    return len(selected)


def private_directory(path):
    if path.is_symlink():
        raise RuntimeError('symlinked maintenance directory')
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    meta = path.stat()
    if meta.st_uid != 0 or meta.st_mode & 0o077:
        raise RuntimeError('maintenance directory must be root-only')


def expire_archives(protected, now):
    entries = []
    total = sum(f.stat().st_size for f in ARCHIVES.glob('*/*') if f.is_file() and not f.is_symlink())
    for directory in ARCHIVES.iterdir():
        if directory.is_symlink() or not re.fullmatch('[a-f0-9]{64}', directory.name):
            continue
        marker = directory/'verified.json'
        if not marker.is_file() or marker.is_symlink():
            continue  # interrupted work is preserved for inspection
        try:
            value = json.loads(marker.read_text())
        except (ValueError, OSError):
            continue
        if value.get('schema') != 'hb.storage-archive/v1' or value['imageId'] != 'sha256:'+directory.name:
            raise RuntimeError('unrecognized archive manifest')
        files = list(directory.iterdir())
        if any(f.is_symlink() or not f.is_file() for f in files):
            raise RuntimeError('unsafe archive contents')
        entries.append((value['createdAt'], directory, sum(f.stat().st_size for f in files), value['imageId']))
    for stamp, directory, size, image_id in sorted(entries):
        age = now-stamp
        if image_id in protected or age < MIN_ARCHIVE_AGE:
            continue
        if age > MAX_ARCHIVE_AGE or total > ARCHIVE_BUDGET:
            shutil.rmtree(directory)
            total -= size
    return total


def archive_image(image, budget_used):
    image_id = image['Id']
    if not re.fullmatch('sha256:[a-f0-9]{64}', image_id):
        raise RuntimeError('invalid image ID')
    directory = ARCHIVES/image_id.split(':')[1]
    if directory.exists():
        marker = directory/'verified.json'
        compressed = directory/'image.tar.zst'
        if (directory.is_symlink() or marker.is_symlink() or compressed.is_symlink()
                or not marker.is_file() or not compressed.is_file()):
            return None  # Preserve incomplete evidence; continue other candidates.
        try:
            value = json.loads(marker.read_text())
        except (ValueError, OSError):
            return None
        with compressed.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        if (value.get('schema') != 'hb.storage-archive/v1' or value.get('imageId') != image_id
                or value.get('archiveSha256') != digest or not value.get('dockerLoadRoundtrip')):
            return None
        run('zstd', '--test', '--quiet', str(compressed), timeout=900)
        # A restored image can be retired again; restart its recovery grace.
        value['createdAt'] = time.time()
        temporary = directory/'verified.tmp'
        with temporary.open('w') as output:
            output.write(json.dumps(value, indent=2)+'\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, marker)
        for path in (compressed, marker, directory, ARCHIVES):
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        return 0  # Already counted in archive budget.

    if shutil.disk_usage(ARCHIVES).free < DATA_RESERVE + 3*image['Size']:
        raise RuntimeError('insufficient archive disk reserve')
    if budget_used + image['Size'] > ARCHIVE_BUDGET:
        raise RuntimeError('archive retention budget reached')
    private_directory(directory)
    tar = directory/'image.tar'
    run('docker', 'image', 'save', '-o', str(tar), *image['RepoTags'], timeout=900)
    count = 0
    with tarfile.open(tar, 'r|') as stream:
        for member in stream:
            if member.isfile() and member.name.startswith('blobs/sha256/'):
                digest = hashlib.file_digest(stream.extractfile(member), 'sha256').hexdigest()
                if digest != member.name.rsplit('/', 1)[1]:
                    raise RuntimeError('archive blob verification failed')
                count += 1
    if count < 2:
        raise RuntimeError('archive has no verifiable content-addressed image')
    run('docker', 'image', 'load', '-i', str(tar), timeout=900)
    restored = json.loads(run('docker', 'image', 'inspect', *image['RepoTags']))
    if any(item['Id'] != image_id for item in restored):
        raise RuntimeError('restored image identity mismatch')
    run('zstd', '-T2', '-3', '--quiet', str(tar), timeout=900)
    compressed = directory/'image.tar.zst'
    run('zstd', '--test', '--quiet', str(compressed), timeout=900)
    with compressed.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    marker = {'schema': 'hb.storage-archive/v1', 'createdAt': time.time(), 'imageId': image_id,
              'tags': image['RepoTags'], 'archiveSha256': digest, 'blobsVerified': count,
              'dockerLoadRoundtrip': True}
    with compressed.open('rb') as source:
        os.fsync(source.fileno())
    with (directory/'verified.json').open('w') as output:
        output.write(json.dumps(marker, indent=2)+'\n')
        output.flush()
        os.fsync(output.fileno())
    for path in (directory, ARCHIVES):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    tar.unlink()
    return compressed.stat().st_size


def maintain():
    private_directory(STATE)
    handles = []
    try:
        for path in [str(STATE/'operation.lock'), *LOCKS]:
            parent = Path(path).parent
            if not parent.exists():
                private_directory(parent)
            fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            handles.append(fd)
            metadata = os.fstat(fd)
            if metadata.st_uid != 0 or not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                raise RuntimeError('unsafe deployment lock')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not Path('/mnt/beacon-data').is_mount():
            raise RuntimeError('archive disk not mounted')
        private_directory(ARCHIVES)
        images, used = inventory()
        candidates, protected = selection(images, used, time.time())
        budget = expire_archives(protected, time.time())
        cache = cache_cleanup()
        retired = []
        incomplete = []
        for candidate in candidates:
            if free_ratio() >= TARGET_FREE or len(retired) >= MAX_IMAGES_PER_RUN:
                break
            # Refresh both protection and tags immediately before archive and removal.
            current, current_used = inventory()
            eligible, _ = selection(current, current_used, time.time())
            matching = [i for i in eligible if i['Id'] == candidate['Id'] and i['RepoTags'] == candidate['RepoTags']]
            if not matching:
                continue
            archived = archive_image(candidate, budget)
            if archived is None:
                incomplete.append(candidate['Id'])
                continue
            budget += archived
            current, current_used = inventory()
            eligible, _ = selection(current, current_used, time.time())
            if not any(i['Id'] == candidate['Id'] and i['RepoTags'] == candidate['RepoTags'] for i in eligible):
                raise RuntimeError('image references changed after archive')
            # No --force. Docker also refuses removal if a container appeared meanwhile.
            if len(candidate['RepoTags']) == 1:
                run('docker', 'image', 'rm', candidate['Id'], timeout=120)
            else:
                # Immutable SHA tags only; mutable tags are excluded by selection.
                run('docker', 'image', 'rm', *candidate['RepoTags'], timeout=120)
            retired.append(candidate['Id'])
        return {'cacheRecordsRetired': cache, 'imagesRetired': retired, 'incompleteArchives': incomplete, 'rootFreeRatio': free_ratio()}
    except BlockingIOError:
        return {'deferred': 'delivery-or-maintenance-active', 'rootFreeRatio': free_ratio()}
    finally:
        for fd in handles:
            os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.apply:
        images, used = inventory()
        candidates, protected = selection(images, used, time.time())
        print(json.dumps({'rootFreeRatio': free_ratio(), 'targetFreeRatio': TARGET_FREE,
                          'protectedImages': len(protected), 'eligibleImages': [i['Id'] for i in candidates]}, indent=2))
        return
    if os.geteuid() != 0:
        parser.error('--apply requires the root-owned service')
    os.umask(0o077)
    try:
        result = maintain()
        healthy = int(not result.get('incompleteArchives'))
    except Exception as exc:
        # Command stderr can contain private host data; expose only the exception class.
        result = {'error': 'maintenance failed; inspect protected local state; no broad prune attempted',
                  'errorType': type(exc).__name__}
        healthy = 0
    if not result.get('deferred'):
        temporary = METRICS.with_suffix('.tmp')
        temporary.write_text(f'beacon_storage_maintenance_up {healthy}\nbeacon_storage_maintenance_timestamp_seconds {time.time()}\n')
        temporary.chmod(0o644)
        os.replace(temporary, METRICS)
    (STATE/'last-result.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))
    raise SystemExit(0 if healthy else 1)


if __name__ == '__main__':
    main()
