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

def operate(environment):
    if environment not in TARGETS: raise RuntimeError('Unknown environment')
    request_file = CONFIG / environment / 'request.json'
    for path in [Path(__file__).resolve(), BUNDLE, MANIFEST, request_file]: custody(path, path in [MANIFEST, request_file])
    if request_file.stat().st_size > 65536 or MANIFEST.stat().st_size > 16384 or BUNDLE.stat().st_size > 8_388_608:
        raise RuntimeError('Input size bound exceeded')
    request = json.loads(request_file.read_text()); manifest = json.loads(MANIFEST.read_text())
    if set(manifest) != {'bundleSha256','sourceSha','compatibleRuntimeShas'} or \
        not re.fullmatch(r'[a-f0-9]{40}', manifest.get('sourceSha', '')) or \
        not isinstance(manifest['compatibleRuntimeShas'], list) or not 1 <= len(manifest['compatibleRuntimeShas']) <= 16 or \
        any(not isinstance(v, str) or not re.fullmatch(r'[a-f0-9]{40}', v) for v in manifest['compatibleRuntimeShas']) or \
        manifest['bundleSha256'] != hashlib.sha256(BUNDLE.read_bytes()).hexdigest():
        raise RuntimeError('Reviewed operator bundle identity mismatch')
    runtime = api('GET', '/containers/' + TARGETS[environment] + '/json')
    actual = dict(v.split('=',1) for v in runtime['Config']['Env'])
    revision = actual.get('BEACON_GIT_SHA')
    if request.get('environment') != environment or request.get('expectedSourceSha') != revision or \
        revision not in manifest['compatibleRuntimeShas'] or not runtime['State']['Running']:
        raise RuntimeError('Runtime environment/source mismatch')
    image = api('GET', '/images/' + runtime['Image'] + '/json')
    baked = dict(v.split('=',1) for v in image['Config'].get('Env', []))
    if baked.get('BEACON_GIT_SHA') != revision: raise RuntimeError('Immutable image/source mismatch')
    operation = request.get('operation')
    if operation not in ['provision','revoke','close','request']: raise RuntimeError('Unsupported operation')
    if request.get('tokenPath') or request.get('responsePath'): raise RuntimeError('Wrapper owns credential/output paths')
    credential = CONFIG / environment / 'credential'
    if operation == 'provision' and credential.exists(): raise RuntimeError('Preserve/revoke prior credential before issuing another')
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True); custody(STATE)
    run_id = uuid.uuid4().hex; directory = STATE / run_id; directory.mkdir(mode=0o700)
    inputs = directory / 'input'; outputs = directory / 'output'; inputs.mkdir(mode=0o700); outputs.mkdir(mode=0o700)
    shutil.copyfile(BUNDLE, inputs / 'beacon-operator.cjs'); os.chmod(inputs / 'beacon-operator.cjs', 0o600)
    if operation == 'provision': request['tokenPath'] = '/run/operator-out/credential'
    if operation == 'request':
        custody(credential, True); shutil.copyfile(credential, inputs / 'credential'); os.chmod(inputs / 'credential', 0o600)
        request['tokenPath'] = '/run/operator-in/credential'; request['responsePath'] = '/run/operator-out/response'
    (inputs / 'request.json').write_text(json.dumps(request)); os.chmod(inputs / 'request.json', 0o600)
    # This record contains no credential values; private API responses remain in output/.
    record = {'helperSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'sourceSha': manifest['sourceSha'], 'bundleSha256': manifest['bundleSha256'],
        'runtimeSourceSha': revision, 'runtimeImage': runtime['Image'], 'environment': environment,
        'operation': operation, 'runId': run_id}
    (directory / 'record.json').write_text(json.dumps(record)); os.chmod(directory / 'record.json', 0o600)
    cid = None
    try:
        config = container_config(runtime, runtime['Image'], environment, inputs, outputs, run_id)
        cid = api('POST', '/containers/create?name=hb-operator-' + run_id, config)['Id']
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
        print(json.dumps({'runId': run_id, 'result': result}))
    finally:
        if cid: api('DELETE', '/containers/' + cid + '?force=true')
        copied = inputs / 'credential'
        if copied.exists(): copied.unlink()

if __name__ == '__main__':
    try:
        if os.geteuid() != 0 or len(sys.argv) != 2: raise RuntimeError('Root and exact environment required')
        os.umask(0o077)
        lock_path = Path('/var/lib/harmonic-beacon/app-bridge/operation.lock'); custody(lock_path)
        with lock_path.open('r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            operate(sys.argv[1])
    except Exception:
        print('Beacon operator stopped; inspect private request/result', file=sys.stderr); sys.exit(1)
