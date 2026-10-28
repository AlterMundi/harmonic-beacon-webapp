#!/usr/bin/python3
"""Bounded owner-admitted app builds for appointed Live operators; no host shell."""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import selectors
import shutil
import signal
import subprocess
import sys
import tarfile
import time
from urllib.request import Request, urlopen

REPO = 'AlterMundi/harmonic-beacon-webapp'
ROOT = Path('/mnt/beacon-data/builds/live-operator')
PERMIT = Path('/etc/harmonic-beacon/live-app-release/permit.json')
RELEASE = Path('/usr/local/sbin/hb-live-app-release')
ENGINE = Path('/usr/local/libexec/harmonic-beacon/live-app-release-v1/hb-live-media-release.py')
STATE = Path('/var/lib/harmonic-beacon/live-app-release')
LOCK = Path('/var/lib/harmonic-beacon/app-bridge/operation.lock')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LC_ALL': 'C',
       'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
SHA = re.compile(r'[0-9a-f]{40}')
MAX_RECORDS = 3


def safe(path, directory=False):
    current = path
    while True:
        s = current.lstat()
        if current.is_symlink() or s.st_uid != 0 or s.st_mode & 0o022:
            raise RuntimeError('unsafe root custody')
        if current == path and (directory != current.is_dir() or
                                (not directory and (not current.is_file() or s.st_nlink != 1))):
            raise RuntimeError('unsafe object type')
        if current == Path('/'): return
        current = current.parent


def run(argv, timeout=60):
    return subprocess.check_output(argv, env=ENV, stderr=subprocess.PIPE, timeout=timeout,
                                   preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (512 * 1024**2, 512 * 1024**2)))


def github(path):
    request = Request('https://api.github.com/repos/' + REPO + '/' + path,
                      headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'beacon-live-candidate'})
    with urlopen(request, timeout=20) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024: raise RuntimeError('GitHub response exceeds bound')
    return json.loads(raw)


def qualify(source, fetch=github):
    if fetch('git/ref/heads/release')['object']['sha'] != source:
        raise RuntimeError('source is not current protected release')
    prs = [p for p in fetch('commits/' + source + '/pulls?per_page=100')
           if p.get('merged_at') and p['base']['ref'] == 'release' and p.get('merge_commit_sha') == source]
    if len(prs) != 1: raise RuntimeError('one merged release PR required')
    head = prs[0]['head']['sha']
    statuses = fetch('commits/' + head + '/statuses?per_page=100')
    gates = [s for s in statuses if s['context'] == 'delivery-gate-release']
    if (not gates or len({s['id'] for s in gates}) != len(gates) or gates[0]['state'] != 'success' or
            gates[0]['creator']['login'] != 'github-actions[bot]' or
            not re.fullmatch('https://github.com/' + REPO + r'/actions/runs/[1-9][0-9]*', gates[0].get('target_url', ''))):
        raise RuntimeError('trusted release gate is not successful')
    pr = prs[0]
    gate_run = fetch('actions/runs/' + gates[0]['target_url'].rsplit('/', 1)[1])
    if (gate_run.get('path') != '.github/workflows/delivery-gate.yml' or
            gate_run.get('event') != 'workflow_dispatch' or gate_run.get('head_branch') != 'release' or
            gate_run.get('head_sha') != pr['base']['sha'] or gate_run.get('conclusion') != 'success' or
            gate_run.get('status') != 'completed'):
        raise RuntimeError('gate run does not bind the trusted protected base')
    # Independently bind real CI to the exact candidate tree, rather than trust
    # a forgeable status URL/creator pair. Compatibility also forbids changing
    # the trusted CI definitions/package commands from the current release.
    if fetch('git/commits/' + source)['tree']['sha'] != fetch('git/commits/' + head)['tree']['sha']:
        raise RuntimeError('merge tree differs from qualified candidate')
    runs = fetch('actions/runs?head_sha=' + head + '&event=pull_request&per_page=100')['workflow_runs']
    runs = sorted([r for r in runs if r.get('path') == '.github/workflows/ci.yml'], key=lambda r:r['id'], reverse=True)
    if not runs: raise RuntimeError('candidate CI run missing')
    ci = runs[0]
    if (ci.get('head_sha') != head or ci.get('head_branch') != pr['head']['ref'] or
            ci.get('event') != 'pull_request' or ci.get('status') != 'completed' or
            ci.get('conclusion') != 'success' or not isinstance(ci.get('run_attempt'), int)):
        raise RuntimeError('latest exact candidate CI did not pass')
    jobs = fetch('actions/runs/' + str(ci['id']) + '/attempts/' + str(ci['run_attempt']) + '/jobs?per_page=100')
    if jobs['total_count'] > 100: raise RuntimeError('CI job inventory exceeds bound')
    required = [j for j in jobs['jobs'] if j.get('name') == 'required-impact-checks']
    if len(required) != 1 or required[0].get('status') != 'completed' or required[0].get('conclusion') != 'success':
        raise RuntimeError('selected candidate checks were not accepted')
    check_url = required[0]['check_run_url']
    if not re.fullmatch('https://api.github.com/repos/' + REPO + r'/check-runs/[1-9][0-9]*', check_url):
        raise RuntimeError('invalid CI check identity')
    check = fetch('check-runs/' + check_url.rsplit('/', 1)[1])
    if (check['app']['id'] != 15368 or check['head_sha'] != head or
            check['check_suite']['id'] != ci['check_suite_id'] or check.get('conclusion') != 'success'):
        raise RuntimeError('CI check is not the exact GitHub Actions run')
    return {'sourceSha': source, 'pr': pr['number'], 'headSha': head,
            'gate': gates[0]['target_url'], 'ciRunId': ci['id'], 'ciAttempt': ci['run_attempt']}



def save(path, value):
    temp = path.with_suffix('.new')
    with temp.open('x') as f:
        os.chmod(temp, 0o600); json.dump(value, f); f.flush(); os.fsync(f.fileno())
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def schema_version():
    database = inspect('beacon-postgres')
    env = dict(v.split('=', 1) for v in database['Config']['Env'])
    query = "SELECT json_build_object('version',max(migration_name) FILTER(WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),'unfinished',count(*) FILTER(WHERE finished_at IS NULL AND rolled_back_at IS NULL)) FROM \"_prisma_migrations\""
    value = json.loads(run(['docker', 'exec', 'beacon-postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
                            '-U', env['POSTGRES_USER'], '-d', env['POSTGRES_DB'], '-Atqc', query]))
    if value['unfinished'] != 0 or not isinstance(value['version'], str) or not re.fullmatch(r'[0-9]{14}_[a-z0-9_]+', value['version']):
        raise RuntimeError('verified unchanged schema coordinate required')
    return value['version']


def compatible(source, prior, directory):
    # This adapter is app-only. Changes to dependencies, schema, media, Compose
    # or build definitions require their owning reviewed delivery instead.
    run(['git', '-C', str(directory), 'fetch', '--depth=1',
         'https://github.com/' + REPO + '.git', prior], timeout=300)
    paths = run(['git', '-C', str(directory), 'diff', '--name-only', prior, source]).decode().splitlines()
    allowed = ('src/', 'docs/', 'e2e/', 'deploy/', '.agents/skills/', 'scripts/ops/__tests__/')
    operational = ('scripts/beacon-staff-api.py',
                   'scripts/live-production/promote-event-manager.ts',
                   'scripts/live-production/promote-event-manager.test.ts')
    if not paths or any(not p.startswith(allowed) and p not in operational for p in paths):
        raise RuntimeError('source requires a broader delivery adapter')


def context_modes(checkout):
    # Git under root's private umask creates0600 files. Restore only tracked
    # context files from their Git modes; retain private parent/custody modes.
    records = run(['git', '-C', str(checkout), 'ls-files', '--stage', '-z']).split(b'\0')
    for record in records:
        if not record: continue
        metadata, name = record.split(b'\t', 1)
        mode = metadata.split()[0]
        relative = Path(os.fsdecode(name))
        if relative.is_absolute() or '..' in relative.parts: raise RuntimeError('unsafe tracked path')
        file = checkout / relative
        if mode in (b'100644', b'100755'):
            if file.is_symlink() or not file.is_file(): raise RuntimeError('tracked regular file changed')
            file.chmod(0o755 if mode == b'100755' else 0o644)
    for path, _, _ in os.walk(checkout): os.chmod(path, 0o755)


def bounded_build(command, logfile):
    p = subprocess.Popen(command, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         start_new_session=True)
    sel = selectors.DefaultSelector(); sel.register(p.stdout, selectors.EVENT_READ)
    start = time.monotonic(); total = 0
    try:
        with logfile.open('xb') as log:
            while sel.get_map():
                if time.monotonic() - start > 3600: raise RuntimeError('build exceeded one hour')
                if min(shutil.disk_usage('/').free, shutil.disk_usage(ROOT).free) < 10 * 1024**3:
                    raise RuntimeError('build stopped at10GiB filesystem reserve')
                for key, _ in sel.select(1):
                    data = os.read(key.fileobj.fileno(), 65536)
                    if not data: sel.unregister(key.fileobj); continue
                    total += len(data)
                    if total > 20 * 1024**2: raise RuntimeError('build log exceeds20MiB')
                    log.write(data); log.flush()
            if p.wait(timeout=30): raise RuntimeError('candidate build failed')
    finally:
        if p.poll() is None:
            os.killpg(p.pid, signal.SIGTERM)
            try: p.wait(timeout=15)
            except subprocess.TimeoutExpired: os.killpg(p.pid, signal.SIGKILL); p.wait()
        sel.close()


def worker(source):
    directory = ROOT / source; safe(directory, True)
    safe(ROOT / 'build.lock')
    lock = (ROOT / 'build.lock').open('r+')
    fcntl.flock(lock, fcntl.LOCK_EX)
    safe(ROOT / 'active.json')
    if json.loads((ROOT / 'active.json').read_text())['sourceSha'] != source:
        raise RuntimeError('build ownership changed')
    try:
        admission = qualify(source)
        if shutil.disk_usage('/').free < 20 * 1024**3 or shutil.disk_usage(ROOT).free < 20 * 1024**3:
            raise RuntimeError('20GiB root/data reserve required')
        checkout = directory / 'source'
        run(['git', 'init', str(checkout)])
        run(['git', '-C', str(checkout), 'fetch', '--depth=1',
             'https://github.com/' + REPO + '.git', source], timeout=300)
        tree = run(['git', '-C', str(checkout), 'ls-tree', '-rlz', source]).split(b'\0')
        files = [r.split(b'\t', 1)[0].split() for r in tree if r]
        if len(files) > 10000 or sum(int(r[3]) for r in files if r[3] != b'-') > 256 * 1024**2:
            raise RuntimeError('tracked source exceeds256MiB/10000files')
        run(['git', '-C', str(checkout), 'checkout', '--detach', source], timeout=120)
        if run(['git', '-C', str(checkout), 'rev-parse', 'HEAD']).decode().strip() != source:
            raise RuntimeError('checkout source mismatch')
        baseline = inspect('beacon-app')
        prior = baseline['Config']['Labels']['org.opencontainers.image.revision']
        if not SHA.fullmatch(prior): raise RuntimeError('invalid current source')
        compatible(source, prior, checkout)
        context_modes(checkout)
        image = 'harmonic-beacon/live:' + source
        now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        schema = schema_version()
        if not (checkout / 'prisma' / 'migrations' / schema).is_dir():
            raise RuntimeError('current schema is absent from candidate source')
        bounded_build(['docker', 'build', '--progress=plain', '--label',
                       'org.opencontainers.image.revision=' + source, '--build-arg',
                       'BEACON_GIT_SHA=' + source, '--build-arg', 'BEACON_BUILD_TIME=' + now,
                       '--build-arg', 'BEACON_DATABASE_SCHEMA_VERSION=' + schema,
                       '--tag', image, str(checkout)], directory / 'build.log')
        artifact = json.loads(run(['docker', 'image', 'inspect', image]))[0]
        if artifact['Config']['Labels']['org.opencontainers.image.revision'] != source:
            raise RuntimeError('image provenance mismatch')
        script = "const fs=require('fs'),p=require('path');if(process.getuid()===0)throw Error('root');for(const n of fs.readdirSync('/app/public',{recursive:true}))fs.accessSync(p.join('/app/public',n),fs.constants.R_OK);"
        run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
             '--security-opt', 'no-new-privileges', '--entrypoint', 'node', artifact['Id'], '-e', script])
        save(directory / 'result.json', {**admission, 'phase': 'built', 'imageId': artifact['Id'],
                                           'priorImageId': baseline['Image'], 'priorSourceSha': prior, 'schemaVersion': schema})
        shutil.rmtree(checkout)
    except Exception as error:
        save(directory / 'result.json', {'sourceSha': source, 'phase': 'failed',
                                         'reason': str(error)[:180] if type(error) is RuntimeError else 'External operation failed; inspect retained private evidence.',
                                         'action': 'Inspect retained root-private build evidence; do not replay uncertain work.'})
        raise
    finally: lock.close()


def terminal_previous(old):
    for state in (STATE / old['permitId']).glob('*/*/state.json'):
        safe(state)
        if json.loads(state.read_text()).get('phase') not in ('applied', 'rolled-back'):
            raise RuntimeError('previous transaction requires recovery before admission')


def admit(source):
    safe(ROOT / source / 'result.json')
    result = json.loads((ROOT / source / 'result.json').read_text())
    if result.get('phase') != 'built' or result.get('sourceSha') != source:
        raise RuntimeError('completed exact build required')
    qualify(source)
    for p in [PERMIT, RELEASE, ENGINE, LOCK]: safe(p)
    with LOCK.open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old = json.loads(PERMIT.read_text()); terminal_previous(old)
        current = inspect('beacon-app'); prior = current['Image']
        prior_source = current['Config']['Labels']['org.opencontainers.image.revision']
        if prior != result['priorImageId'] or prior_source != result['priorSourceSha']:
            raise RuntimeError('qualified build base changed; a new qualification is required')
        if schema_version() != result['schemaVersion']:
            raise RuntimeError('qualified schema coordinate changed before admission')
        image = json.loads(run(['docker', 'image', 'inspect', result['imageId']]))[0]
        if image['Config']['Labels']['org.opencontainers.image.revision'] != source or prior == image['Id']:
            raise RuntimeError('distinct exact image and provenance required')
        # A replay never replaces the active transaction or extends its expiry.
        if old['sourceSha'] == source and old['candidateImageId'] == image['Id']:
            return {'phase': 'admitted', 'sourceSha': source, 'expiresAt': old['expiresAt']}
        prior_bundle = STATE / 'bundles' / old['permitId']
        if prior_bundle.exists(): raise RuntimeError('previous bundle already retained; inspect before rotation')
        prior_bundle.mkdir()
        for path, name in [(PERMIT, 'permit.json'), (RELEASE, 'hb-live-app-release'), (ENGINE, 'hb-live-media-release.py')]:
            shutil.copyfile(path, prior_bundle / name); (prior_bundle / name).chmod(0o600)
        run(['docker', 'tag', prior, 'harmonic-beacon/live:rollback-' + prior_source])
        value = {'permitId': os.urandom(32).hex(), 'sourceSha': source,
                 'priorSourceSha': prior_source, 'candidateImageId': image['Id'], 'priorImageId': prior,
                 'expiresAt': (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=23)).isoformat()}
        save(PERMIT, value)
        return {'phase': 'admitted', 'sourceSha': source, 'imageId': image['Id'], 'expiresAt': value['expiresAt']}


def retire(source):
    # Only derived source contexts/build logs are retired. Images, deployment
    # snapshots, permits, credentials and application data are never deleted.
    safe(ROOT / 'build.lock'); safe(LOCK); safe(PERMIT)
    with (ROOT / 'build.lock').open('r+') as build_lock, LOCK.open('r+') as release_lock:
        fcntl.flock(build_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(release_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        directory = ROOT / source; safe(directory, True)
        result_path = directory / 'result.json'; safe(result_path)
        result = json.loads(result_path.read_text())
        if result.get('sourceSha') != source or result.get('phase') not in ('built', 'failed'):
            raise RuntimeError('only terminal build evidence can be retired')
        permit = json.loads(PERMIT.read_text())
        protected = {permit['sourceSha'], permit['priorSourceSha']}
        containers = run(['docker', 'ps', '-aq']).decode().split()
        if len(containers) > 256: raise RuntimeError('runtime inventory exceeds bound')
        if containers:
            bindings = run(['docker', 'inspect', '--format',
                            '{{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}', *containers]).decode().splitlines()
            for row in bindings:
                fields = row.split()
                if len(fields) > 1 and SHA.fullmatch(fields[1]): protected.add(fields[1])
                if fields and fields[0] == result.get('imageId'):
                    raise RuntimeError('build image remains referenced by a container')
        if source in protected: raise RuntimeError('build remains a current/admitted/recovery source')
        history = ROOT / 'retired'
        if not history.exists(): history.mkdir(mode=0o700)
        safe(history, True)
        archives = sorted(history.glob('*.tar.gz'), key=lambda p:p.stat().st_mtime)
        while len(archives) >= 6:
            candidates = [p for p in archives if SHA.fullmatch(p.name[:40]) and p.name[:40] not in protected]
            if not candidates: raise RuntimeError('retired evidence ceiling is protected')
            old = candidates[0]; safe(old); old.unlink(); archives.remove(old)
        evidence = [result_path]
        log = directory / 'build.log'
        if log.exists(): safe(log); evidence.append(log)
        if any(p.stat().st_size > 20 * 1024**2 for p in evidence):
            raise RuntimeError('retirement evidence exceeds bound')
        archive = history / (source + '-' + os.urandom(8).hex() + '.tar.gz')
        digests = {}
        for p in evidence:
            with p.open('rb') as stream: digests[p.name] = hashlib.file_digest(stream, 'sha256').hexdigest()
        pending = history / (source + '.pending')
        with tarfile.open(pending, 'x:gz', compresslevel=3) as tar:
            for p in evidence: tar.add(p, arcname=p.name, recursive=False)
        pending.chmod(0o600)
        with tarfile.open(pending, 'r:gz') as tar:
            if {m.name for m in tar.getmembers()} != set(digests):
                raise RuntimeError('retirement archive inventory mismatch')
            for member in tar.getmembers():
                with tar.extractfile(member) as stream:
                    if hashlib.file_digest(stream, 'sha256').hexdigest() != digests[member.name]:
                        raise RuntimeError('retirement archive verification failed')
        with pending.open('rb') as stream:
            os.fsync(stream.fileno()); checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
        os.replace(pending, archive)
        parent = os.open(history, os.O_DIRECTORY)
        try: os.fsync(parent)
        finally: os.close(parent)
        shutil.rmtree(directory)
        active = ROOT / 'active.json'
        if active.exists():
            safe(active)
            if json.loads(active.read_text())['sourceSha'] == source: active.unlink()
        return {'phase': 'retired', 'sourceSha': source, 'evidenceSha256': checksum,
                'action': 'Terminal evidence retained under six-archive policy; no image or recovery state deleted.'}


def readback(source):
    safe(LOCK)
    with LOCK.open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        services = []
        for name in ['beacon-app', 'hb-live-staging-app', 'beacon-commerce-reconciler',
                     'beacon-postgres', 'beacon-livekit', 'beacon-playlist-bot', 'beacon-tapestry']:
            value = inspect(name)
            services.append({'name': name, 'containerId': value['Id'], 'imageId': value['Image'],
                             'sourceSha': (value['Config'].get('Labels') or {}).get('org.opencontainers.image.revision'),
                             'running': value['State']['Running'],
                             'health': value['State'].get('Health', {}).get('Status')})
        database = inspect('beacon-postgres')
        env = dict(v.split('=', 1) for v in database['Config']['Env'])
        query = "SELECT json_build_object('live',count(*) FILTER(WHERE status='LIVE'),'next',min(scheduled_at) FILTER(WHERE status='SCHEDULED' AND NOT is_test AND scheduled_at>=now()),'within24h',count(*) FILTER(WHERE status='SCHEDULED' AND NOT is_test AND scheduled_at>=now() AND scheduled_at<=now()+interval '24 hours')) FROM scheduled_sessions"
        agenda = json.loads(run(['docker', 'exec', 'beacon-postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
                                 '-U', env['POSTGRES_USER'], '-d', env['POSTGRES_DB'], '-Atqc', query]))
        return {'expectedSourceSha': source, 'services': services, 'agenda': agenda,
                'observedAt': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}


def main(args):
    if os.geteuid() != 0 or len(args) != 2 or args[0] not in ('build', 'status', 'admit', 'readback', 'retire', '_worker') or not SHA.fullmatch(args[1]):
        raise RuntimeError('usage: hb-live-candidate build|status|admit|readback|retire SHA40')
    os.umask(0o077)
    safe(Path(__file__).absolute()); safe(ROOT, True)
    verb, source = args; directory = ROOT / source
    if verb == 'retire': return retire(source)
    if verb == 'readback': return readback(source)
    if verb == 'status':
        safe(directory, True)
        result = directory / 'result.json'
        if result.exists(): safe(result); return json.loads(result.read_text())
        return {'phase': 'pending', 'sourceSha': source, 'action': 'Inspect the named job; pending is not proof it is running.'}
    if verb == 'admit': return admit(source)
    if verb == '_worker': worker(source); return {'phase': 'built', 'sourceSha': source}
    lockpath = ROOT / 'build.lock'; safe(lockpath)
    with lockpath.open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if directory.exists(): return {'phase': 'retained', 'sourceSha': source, 'action': 'Read status; no duplicate build started.'}
        if len([p for p in ROOT.iterdir() if p.is_dir() and SHA.fullmatch(p.name)]) >= MAX_RECORDS:
            raise RuntimeError('three retained builds reached; retire an unreferenced terminal build before more work')
        active = ROOT / 'active.json'
        if active.exists():
            safe(active)
            previous = json.loads(active.read_text())['sourceSha']
            if not SHA.fullmatch(previous): raise RuntimeError('invalid retained build identity')
            result = ROOT / previous / 'result.json'
            if not result.exists(): raise RuntimeError('retained build is pending or uncertain; inspect before another build')
            safe(result)
        qualify(source); directory.mkdir(mode=0o700)
        save(active, {'sourceSha': source})
        # The marker closes the launcher/worker race. Other launches refuse a
        # nonterminal marker; the worker holds the global lock throughout its job.
        # GNU screen must fork before this launcher releases the build lock.
        subprocess.run(['/usr/bin/screen', '-dmS', 'beacon-live-' + source[:12],
                        '/usr/bin/python3', '-I', str(Path(__file__).resolve()), '_worker', source],
                       env=ENV, check=True, timeout=20)
        return {'phase': 'queued', 'sourceSha': source, 'action': 'Read status; preserve the named job after SSH loss.'}


if __name__ == '__main__':
    try: print(json.dumps(main(sys.argv[1:])))
    except Exception:
        print('Live candidate operation stopped; inspect retained private evidence.', file=sys.stderr)
        sys.exit(1)
