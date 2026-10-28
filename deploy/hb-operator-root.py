#!/usr/bin/env python3
"""Root-owned, fixed-image, read-only container adapter for the Beacon operator CLI."""
import fcntl
import hashlib
import http.client
import json
import os
import re
from pathlib import Path
import shutil
import socket
import struct
import sys
import time
import uuid

CONFIG = Path('/etc/harmonic-beacon/operator')
BUNDLE = Path('/usr/local/libexec/harmonic-beacon/operator/beacon-operator.cjs')
MANIFEST = BUNDLE.with_name('manifest.json')
STATE = Path('/var/lib/harmonic-beacon/operator')
TARGETS = {'production': 'beacon-app', 'staging': 'hb-live-staging-app'}

class DockerConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=90)
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')

def api(method, path, body=None):
    connection = DockerConnection()
    try:
        connection.request(method, '/v1.45' + path,
            None if body is None else json.dumps(body).encode(), {'Content-Type': 'application/json'})
        response = connection.getresponse()
        raw = response.read(2_097_153)
        if len(raw) > 2_097_152 or response.status >= 300:
            raise RuntimeError('Docker operation failed')
        return json.loads(raw) if raw and response.getheader('Content-Type', '').startswith('application/json') else raw
    finally:
        connection.close()

def custody(path, private=False):
    current = path
    while True:
        info = current.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or current.is_symlink():
            raise RuntimeError('Unsafe root custody')
        if current == path and current.is_file():
            if info.st_nlink != 1 or (private and info.st_mode & 0o777 != 0o600):
                raise RuntimeError('Unsafe root file')
        if current == Path('/'): break
        current = current.parent

MAX_BUNDLE_BYTES = 8_388_608
MAX_GENERATIONS = 64


def verified_bundle(bundle, manifest_path, private=False):
    custody(bundle, private); custody(manifest_path, True)
    if not bundle.is_file() or not manifest_path.is_file() or not 0 < bundle.stat().st_size <= MAX_BUNDLE_BYTES or manifest_path.stat().st_size > 16384:
        raise RuntimeError('Operator bundle size/type bound exceeded')
    manifest = json.loads(manifest_path.read_text())
    if set(manifest) != {'bundleSha256', 'sourceSha', 'compatibleRuntimeShas'} or \
        not isinstance(manifest.get('sourceSha'), str) or not re.fullmatch(r'[a-f0-9]{40}', manifest['sourceSha']) or \
        not isinstance(manifest['compatibleRuntimeShas'], list) or not 1 <= len(manifest['compatibleRuntimeShas']) <= 16 or \
        any(not isinstance(v, str) or not re.fullmatch(r'[a-f0-9]{40}', v) for v in manifest['compatibleRuntimeShas']) or \
        manifest['bundleSha256'] != hashlib.sha256(bundle.read_bytes()).hexdigest():
        raise RuntimeError('Reviewed operator bundle identity mismatch')
    return manifest


def select_bundle(revision):
    if not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise RuntimeError('Invalid runtime source')
    generation = BUNDLE.parent / 'runtimes' / revision
    # A present but incomplete/unsafe generation must not fall back silently.
    if generation.exists() or generation.is_symlink():
        custody(generation)
        if not generation.is_dir(): raise RuntimeError('Invalid operator generation')
        bundle, manifest_path = generation / BUNDLE.name, generation / MANIFEST.name
        manifest = verified_bundle(bundle, manifest_path, True)
        if manifest['sourceSha'] != revision or manifest['compatibleRuntimeShas'] != [revision]:
            raise RuntimeError('Exact runtime operator generation mismatch')
    else:
        bundle, manifest = BUNDLE, verified_bundle(BUNDLE, MANIFEST)
    if revision not in manifest['compatibleRuntimeShas']:
        raise RuntimeError('Operator generation does not admit runtime source')
    return bundle, manifest


def install_generation(source, bundle, expected_digest):
    """Root-only immutable publish; caller holds the existing app operation lock."""
    if os.geteuid() != 0 or not isinstance(source, str) or not re.fullmatch('[a-f0-9]{40}', source):
        raise RuntimeError('Root and exact generation source required')
    custody(Path(__file__).resolve()); custody(BUNDLE.parent)
    custody(bundle, True)
    if not bundle.is_file() or not 0 < bundle.stat().st_size <= MAX_BUNDLE_BYTES:
        raise RuntimeError('Invalid compiler output type/size')
    raw = bundle.read_bytes()
    if not re.fullmatch('[a-f0-9]{64}', expected_digest) or hashlib.sha256(raw).hexdigest() != expected_digest:
        raise RuntimeError('Compiler output digest mismatch')
    root = BUNDLE.parent / 'runtimes'
    if not root.exists(): root.mkdir(mode=0o700)
    custody(root)
    generation = root / source
    if generation.exists() or generation.is_symlink():
        selected, manifest = select_bundle(source)
        if selected.parent != generation or manifest['bundleSha256'] != expected_digest:
            raise RuntimeError('Immutable operator generation already differs')
        return manifest
    if len([p for p in root.iterdir() if re.fullmatch('[a-f0-9]{40}', p.name)]) >= MAX_GENERATIONS:
        raise RuntimeError('Operator generation ceiling reached; inspect retained recovery references')
    pending = root / '.pending'
    if pending.exists() or pending.is_symlink():
        raise RuntimeError('Pending operator generation requires inspection')
    pending.mkdir(mode=0o700)
    manifest = {'bundleSha256': expected_digest, 'sourceSha': source, 'compatibleRuntimeShas': [source]}
    try:
        for name, data in [(BUNDLE.name, raw), (MANIFEST.name, (json.dumps(manifest)+'\n').encode())]:
            with (pending / name).open('xb') as output:
                os.chmod(pending / name, 0o600)
                output.write(data); output.flush(); os.fsync(output.fileno())
        verified_bundle(pending / BUNDLE.name, pending / MANIFEST.name)
        fd = os.open(pending, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
        os.rename(pending, generation)
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
    except Exception:
        # Only this invocation's unpublished staging directory is disposable.
        if pending.exists(): shutil.rmtree(pending)
        raise
    return manifest


def decode_logs(raw):
    chunks = []
    while raw:
        if len(raw) < 8: raise RuntimeError('Invalid Docker log framing')
        length = struct.unpack('>I', raw[4:8])[0]
        if len(raw) < length + 8: raise RuntimeError('Truncated Docker logs')
        chunks.append(raw[8:8+length]); raw = raw[8+length:]
    return b''.join(chunks)

def container_config(runtime, image, environment, inputs, outputs, run_id):
    allowed = {'DATABASE_URL', 'NODE_ENV', 'BEACON_GIT_SHA', 'BEACON_PUBLIC_ORIGIN',
        'NEXT_PUBLIC_LIVEKIT_URL', 'LIVEKIT_INTERNAL_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET',
        'LIVEKIT_IDENTITY_SECRET', 'LIVEKIT_ROOM_NAME'}
    env = [v for v in runtime['Config']['Env'] if v.split('=', 1)[0] in allowed]
    return {'Image': image, 'User': '0:0', 'WorkingDir': '/app',
        'Entrypoint': ['node'], 'Cmd': ['/run/operator-in/beacon-operator.cjs', '/run/operator-in/request.json'],
        'Env': env + ['BEACON_OPERATOR_ENVIRONMENT=' + environment, 'NODE_PATH=/app/node_modules'],
        'Labels': {'com.harmonicbeacon.operator.run': run_id},
        'HostConfig': {'ReadonlyRootfs': True, 'NetworkMode': 'container:' + runtime['Id'],
            'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges:true'], 'Memory': 536870912,
            'NanoCpus': 1_000_000_000, 'PidsLimit': 128,
            'Binds': [str(inputs) + ':/run/operator-in:ro', str(outputs) + ':/run/operator-out:rw'],
            'Tmpfs': {'/tmp': 'rw,noexec,nosuid,nodev,size=16m'}}}

def profile_directory(environment, operator=None):
    if environment not in TARGETS: raise RuntimeError("Unknown environment")
    if operator is not None and not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", operator):
        raise RuntimeError("Invalid operator profile")
    base = CONFIG / environment
    return base if operator is None else base / "operators" / operator

def operate(environment, operator=None):
    if environment not in TARGETS: raise RuntimeError('Unknown environment')
    profile = profile_directory(environment, operator)
    request_file = profile / 'request.json'
    for path in [Path(__file__).resolve(), request_file]: custody(path, path == request_file)
    if request_file.stat().st_size > 65536:
        raise RuntimeError('Input size bound exceeded')
    request = json.loads(request_file.read_text())
    runtime = api('GET', '/containers/' + TARGETS[environment] + '/json')
    actual = dict(v.split('=',1) for v in runtime['Config']['Env'])
    revision = actual.get('BEACON_GIT_SHA')
    if request.get('environment') != environment or request.get('expectedSourceSha') != revision or \
        not runtime['State']['Running']:
        raise RuntimeError('Runtime environment/source mismatch')
    image = api('GET', '/images/' + runtime['Image'] + '/json')
    baked = dict(v.split('=',1) for v in image['Config'].get('Env', []))
    if baked.get('BEACON_GIT_SHA') != revision: raise RuntimeError('Immutable image/source mismatch')
    bundle, manifest = select_bundle(revision)
    operation = request.get('operation')
    if operation not in ['provision','revoke','close','request']: raise RuntimeError('Unsupported operation')
    if request.get('tokenPath') or request.get('responsePath'): raise RuntimeError('Wrapper owns credential/output paths')
    credential = profile / 'credential'
    if operation == 'provision' and credential.exists(): raise RuntimeError('Preserve/revoke prior credential before issuing another')
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True); custody(STATE)
    run_id = uuid.uuid4().hex; directory = STATE / run_id; directory.mkdir(mode=0o700)
    inputs = directory / 'input'; outputs = directory / 'output'; inputs.mkdir(mode=0o700); outputs.mkdir(mode=0o700)
    shutil.copyfile(bundle, inputs / 'beacon-operator.cjs'); os.chmod(inputs / 'beacon-operator.cjs', 0o600)
    if operation == 'provision': request['tokenPath'] = '/run/operator-out/credential'
    if operation == 'request':
        custody(credential, True); shutil.copyfile(credential, inputs / 'credential'); os.chmod(inputs / 'credential', 0o600)
        request['tokenPath'] = '/run/operator-in/credential'; request['responsePath'] = '/run/operator-out/response'
    (inputs / 'request.json').write_text(json.dumps(request)); os.chmod(inputs / 'request.json', 0o600)
    # This record contains no credential values; private API responses remain in output/.
    record = {'helperSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'sourceSha': manifest['sourceSha'], 'bundleSha256': manifest['bundleSha256'],
        'runtimeSourceSha': revision, 'runtimeImage': runtime['Image'], 'environment': environment,
        'operation': operation, 'operatorProfile': operator, 'runId': run_id}
    (directory / 'record.json').write_text(json.dumps(record)); os.chmod(directory / 'record.json', 0o600)
    cid = None
    try:
        config = container_config(runtime, runtime['Image'], environment, inputs, outputs, run_id)
        cid = api('POST', '/containers/create?name=hb-operator-' + run_id, config)['Id']
        observed = api('GET', '/containers/' + cid + '/json')
        if observed['Image'] != runtime['Image'] or not observed['HostConfig']['ReadonlyRootfs'] or \
            observed['HostConfig']['NetworkMode'] != 'container:' + runtime['Id'] or \
            any(mount['RW'] for mount in observed['Mounts'] if mount['Destination'] == '/run/operator-in'):
            raise RuntimeError('Operator execution boundary readback failed')
        record['executionBoundaryVerified'] = True
        (directory / 'record.json').write_text(json.dumps(record))
        api('POST', '/containers/' + cid + '/start')
        deadline = time.monotonic() + 90
        while True:
            state = api('GET', '/containers/' + cid + '/json')['State']
            if not state['Running']: break
            if time.monotonic() > deadline: raise RuntimeError('Bounded operator command timed out')
            time.sleep(0.25)
        logs = decode_logs(api('GET', '/containers/' + cid + '/logs?stdout=1&stderr=1'))
        (directory / 'result.log').write_bytes(logs); os.chmod(directory / 'result.log', 0o600)
        if state['ExitCode'] != 0: raise RuntimeError('Operator command failed; private result retained')
        result = json.loads(logs.decode().strip().splitlines()[-1])
        if operation == 'provision':
            source = outputs / 'credential'; custody(source, True)
            descriptor = os.open(credential, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as file:
                file.write(source.read_bytes()); file.flush(); os.fsync(file.fileno())
            source.unlink()
        record['complete'] = True; (directory / 'record.json').write_text(json.dumps(record))
        return {'runId': run_id, 'result': result}
    finally:
        if cid: api('DELETE', '/containers/' + cid + '?force=true')
        copied = inputs / 'credential'
        if copied.exists(): copied.unlink()

if __name__ == '__main__':
    try:
        if os.geteuid() != 0 or len(sys.argv) not in (2, 3): raise RuntimeError('Root and exact environment required')
        os.umask(0o077)
        lock_path = Path('/var/lib/harmonic-beacon/app-bridge/operation.lock'); custody(lock_path)
        with lock_path.open('r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(operate(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)))
    except Exception:
        print('Beacon operator stopped; inspect private request/result', file=sys.stderr); sys.exit(1)
