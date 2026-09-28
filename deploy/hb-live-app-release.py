#!/usr/bin/env python3
"""Owner-only app release retaining the existing media staging configuration.

No runner sudo grant. Root admits one exact image pair through the private permit.
The separately installed original #590 helper and its recovery state stay intact.
"""
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

ENGINE = Path('/usr/local/libexec/harmonic-beacon/live-app-release-v1/hb-live-media-release.py')
PERMIT = Path('/etc/harmonic-beacon/live-app-release/permit.json')
ROOT = Path('/var/lib/harmonic-beacon/live-app-release')
FIELDS = {'permitId', 'sourceSha', 'priorSourceSha', 'candidateImageId', 'priorImageId', 'expiresAt'}

def validate_permit(value, verb, now=None):
    if not isinstance(value, dict) or set(value) not in (FIELDS, FIELDS | {'activeTestSessionId'}):
        raise RuntimeError('invalid app release permit')
    for key, pattern in [('permitId', r'[0-9a-f]{64}'), ('sourceSha', r'[0-9a-f]{40}'),
                         ('priorSourceSha', r'[0-9a-f]{40}'), ('candidateImageId', r'sha256:[0-9a-f]{64}'),
                         ('priorImageId', r'sha256:[0-9a-f]{64}')]:
        if not isinstance(value[key], str) or not re.fullmatch(pattern, value[key]):
            raise RuntimeError('invalid app release identity')
    if 'activeTestSessionId' in value and (not isinstance(value['activeTestSessionId'], str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', value['activeTestSessionId'])):
        raise RuntimeError('invalid explicitly authorized test session')
    if value['candidateImageId'] == value['priorImageId']:
        raise RuntimeError('app release requires a distinct candidate')
    expires = datetime.datetime.fromisoformat(value['expiresAt'].replace('Z', '+00:00'))
    if expires.tzinfo is None:
        raise RuntimeError('permit expiry must include timezone')
    if verb in ('prepare', 'apply'):
        now = now or datetime.datetime.now(datetime.timezone.utc)
        if not now < expires <= now + datetime.timedelta(hours=24):
            raise RuntimeError('app release permit expired or exceeds 24 hours')
    return value

def configure(engine, permit, staging, verb, root, fingerprint):
    engine.IMAGES = {'app': (permit['candidateImageId'][7:], permit['priorImageId'][7:]) if staging
                     else (permit['priorImageId'][7:], permit['candidateImageId'][7:])}
    engine.SOURCE = engine.PRIOR_SOURCE = permit['sourceSha']
    engine.implementation_digest = lambda: fingerprint
    transaction = root / permit['permitId']
    rehearsal = transaction / 'rehearsal'
    forward = transaction / 'forward'
    forward_state = forward / 'staging' / 'state.json'
    if forward_state.exists():
        engine.safe_path(forward_state)
    engine.ROOT = forward if not staging or forward_state.exists() else rehearsal
    if staging and verb == 'prepare' and not forward_state.exists():
        first = rehearsal / 'staging' / 'state.json'
        if first.exists():
            engine.safe_path(first)
            state = json.loads(first.read_text())
            if state.get('phase') == 'rolled-back' and state.get('candidateVerified') is True:
                engine.ROOT = forward
    return rehearsal, forward

def require_rehearsal(engine, permit, rehearsal, forward, fingerprint):
    for directory, phase in [(rehearsal, 'rolled-back'), (forward, 'applied')]:
        path = directory / 'staging' / 'state.json'
        engine.safe_path(path)
        value = json.loads(path.read_text())
        if (value.get('phase') != phase or value.get('candidateVerified') is not True
            or value.get('helperSha256') != fingerprint
            or value.get('source') != permit['sourceSha']
            or value.get('targets') != {'app': permit['candidateImageId']}):
            raise RuntimeError('exact staging rollback and forward proof required')
    observed = engine.inspect('hb-live-staging-app')
    if not observed or observed['Image'] != permit['candidateImageId']:
        raise RuntimeError('staging no longer runs the qualified candidate')
    engine.health({'app': 'hb-live-staging-app'}, permit['sourceSha'], 'http://127.0.0.1:3200')

def forward_admission_required(engine, staging, verb):
    if staging or verb not in ('prepare', 'apply'):
        return False
    path = engine.ROOT / 'production' / 'state.json'
    if not path.exists():
        return True
    engine.safe_path(path)
    # Once mutation starts, the continuity callback must allow exact recovery,
    # even if an event enters the window between stopping and replacing app.
    return json.loads(path.read_text()).get('phase') == 'prepared'

def active_test_continuity(engine, session_id, baseline):
    # Explicit owner exception: app only; media/data/worker are never replaced.
    if set(engine.IMAGES) != {'app'}:
        raise RuntimeError('active test exception is app-only')
    for name, identity in baseline.items():
        current = engine.inspect(name)
        if not current or (current['Id'], current['Image']) != identity or not current['State']['Running']:
            raise RuntimeError('protected runtime changed during active test delivery')
    database = engine.env_map(engine.inspect('beacon-postgres')['Config'])
    rows = engine.quiet(['docker', 'exec', 'beacon-postgres', 'psql', '-v', 'ON_ERROR_STOP=1',
        '-U', database['POSTGRES_USER'], '-d', database['POSTGRES_DB'], '-Atqc',
        "SELECT json_build_object('target', count(*) FILTER (WHERE id::text='" + session_id +
        "' AND title LIKE 'Test%'), 'otherLive', count(*) FILTER (WHERE status='LIVE' AND id::text<>'" + session_id + "')) FROM scheduled_sessions"])
    observed = json.loads(rows)
    if observed != {'target': 1, 'otherLive': 0}:
        raise RuntimeError('active test admission does not match current agenda')

def main():
    if os.geteuid() != 0 or len(sys.argv) != 3 or sys.argv[1] not in ('staging', 'production') or sys.argv[2] not in ('prepare', 'apply', 'rollback', 'recover', 'status'):
        raise RuntimeError('usage (owner root only): hb-live-app-release staging|production prepare|apply|rollback|recover|status')
    os.umask(0o077)
    # Validate custody before importing executable bytes.
    for path in [ENGINE, Path(__file__).resolve(), PERMIT]:
        current = path
        while True:
            info = current.lstat()
            if info.st_uid != 0 or info.st_mode & 0o022 or current.is_symlink():
                raise RuntimeError('unsafe owner release custody')
            if current == path and (not current.is_file() or info.st_nlink != 1):
                raise RuntimeError('missing owner release file')
            if current == Path('/'): break
            current = current.parent
    if PERMIT.stat().st_mode & 0o777 != 0o600 or PERMIT.stat().st_size > 16384:
        raise RuntimeError('unsafe permit mode or size')
    spec = importlib.util.spec_from_file_location('live_app_release_engine', ENGINE)
    engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)
    lock_path = Path('/var/lib/harmonic-beacon/app-bridge/operation.lock')
    engine.safe_path(lock_path)
    with lock_path.open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = PERMIT.read_bytes()
        permit = validate_permit(json.loads(raw), sys.argv[2])
        fingerprint = hashlib.sha256(ENGINE.read_bytes() + Path(__file__).read_bytes() + raw).hexdigest()
        for field, source in [('candidateImageId', 'sourceSha'), ('priorImageId', 'priorSourceSha')]:
            image = engine.api('GET', '/images/' + permit[field] + '/json')
            if image['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != permit[source]:
                raise RuntimeError('image source identity mismatch')
        staging = sys.argv[1] == 'staging'
        rehearsal, forward = configure(engine, permit, staging, sys.argv[2], ROOT, fingerprint)
        protected_runtime = {}
        if permit.get('activeTestSessionId') and forward_admission_required(engine, staging, sys.argv[2]):
            for name in ['beacon-postgres', 'beacon-livekit', 'beacon-tapestry', 'beacon-playlist-bot', 'beacon-commerce-reconciler']:
                current = engine.inspect(name)
                if not current or not current['State']['Running']:
                    raise RuntimeError('protected runtime is unavailable')
                protected_runtime[name] = (current['Id'], current['Image'])
        original_continuity = engine.continuity
        def continuity(staging=False, app_available=True):
            if not staging and permit.get('activeTestSessionId'):
                if forward_admission_required(engine, staging, sys.argv[2]):
                    active_test_continuity(engine, permit['activeTestSessionId'], protected_runtime)
            else:
                original_continuity(staging, app_available)
            if forward_admission_required(engine, staging, sys.argv[2]):
                database = engine.env_map(engine.inspect('beacon-postgres')['Config'])
                rows = engine.quiet(['docker', 'exec', 'beacon-postgres', 'psql', '-v', 'ON_ERROR_STOP=1',
                    '-U', database['POSTGRES_USER'], '-d', database['POSTGRES_DB'], '-Atqc',
                    "SELECT count(*) FROM scheduled_sessions WHERE status='SCHEDULED' AND NOT is_test "
                    "AND scheduled_at>=now() AND scheduled_at<=now()+interval '24 hours'"])
                if rows.strip() != b'0':
                    raise RuntimeError('event within 24 hours prevents replacement')
        engine.continuity = continuity
        if not staging and sys.argv[2] in ('prepare', 'apply'):
            require_rehearsal(engine, permit, rehearsal, forward, fingerprint)
        engine.operate(sys.argv[2], staging)

if __name__ == '__main__':
    try: main()
    except Exception:
        print('app release stopped; inspect private transaction and permit', file=sys.stderr)
        sys.exit(1)
