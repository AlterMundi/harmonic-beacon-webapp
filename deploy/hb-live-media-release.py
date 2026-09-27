#!/usr/bin/env python3
"""Owner-operated, fixed-image release #590. Root only; no runner inputs/secrets.

Preserves Docker's effective configuration and prior images. No build, pull,
SQL mutation, migration, or dependency restart. See LIVE_MEDIA_RELEASE.md.
"""
import base64
import copy
import hmac
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

SOURCE = '565c0f31eab9260c6ad7f5ef776f0c19fc4fa36d'
PRIOR_SOURCE = '3ea86853c0a8757cd7ab5362a772570766f9161f'
IMAGES = {
    'app': ('3e53aaa2d69895d25b0103dfb72ddc492ffa0afc89a63bf0a32aa7e9d7256231', '557eafbf809881bbd1d56c3a7caf78e3a516fdfbf18bc807fb5be35330a9ec22'),
    'tapestry': ('5a0bacef5312310439e539e7cec10e73ae2d8ef18731f21bb155d8068d40f344', 'e68668442fe1027be1ca1b315ebf8cd0a78269dbd5c862f2d79e50b629ede807'),
    'playlist-bot': ('5a7b08d76e65b9f3ad025642483717675a68bcbb03eadbc7f8e6afcca3220915', '20616d1a30e89669bf90c7aadb3255243ba64256e11613c7ffb4159543cb429c'),
}
ROOT = Path('/var/lib/harmonic-beacon/media-release-590')

class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')

def api(method, path, body=None, missing=False):
    connection = UnixHTTP('localhost', timeout=90)
    try:
        connection.request(method, '/v1.52' + path,
                           None if body is None else json.dumps(body),
                           {'Content-Type': 'application/json'})
        response = connection.getresponse()
        data = response.read()
        if missing and response.status == 404:
            return None
        if response.status not in (200, 201, 204, 304):
            raise RuntimeError(f'Docker {method} failed: HTTP {response.status}')
        return json.loads(data) if data else None
    finally:
        connection.close()

def inspect(name):
    return api('GET', '/containers/' + quote(name, safe='') + '/json', missing=True)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()

def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def save(path, value):
    temporary = path.with_suffix('.tmp')
    with open(temporary, 'w', encoding='utf8') as file:
        os.chmod(temporary, 0o600)
        json.dump(value, file, sort_keys=True)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def env_map(config):
    return dict(item.split('=', 1) for item in config['Env'])

def replacement(snapshot, image, image_config=None):
    config = copy.deepcopy(snapshot['Config'])
    config['Image'] = image
    if image_config is not None:
        if (config['Cmd'], config['Entrypoint']) != (image_config['Cmd'], image_config['Entrypoint']):
            raise RuntimeError('candidate startup contract changed')
        labels = config.setdefault('Labels', {})
        for key, value in (image_config.get('Labels') or {}).items():
            if key.startswith('org.opencontainers.image.'):
                labels[key] = value
        environment = env_map(config)
        for key, value in env_map(image_config).items():
            environment.setdefault(key, value)
        # These are image provenance defaults, not production configuration.
        for key, value in env_map(image_config).items():
            if key in ('BEACON_GIT_SHA', 'BEACON_BUILD_TIME', 'BEACON_DATABASE_SCHEMA_VERSION'):
                environment[key] = value
        config['Env'] = [key + '=' + value for key, value in environment.items()]
    config['HostConfig'] = copy.deepcopy(snapshot['HostConfig'])
    endpoints = {}
    for name, endpoint in snapshot['NetworkSettings']['Networks'].items():
        if endpoint.get('IPAMConfig'):
            raise RuntimeError('static IP configuration requires separate review')
        aliases = [a for a in endpoint.get('Aliases') or []
                   if a not in (snapshot['Id'], snapshot['Id'][:12])]
        endpoints[name] = {'Aliases': aliases}
    config['NetworkingConfig'] = {'EndpointsConfig': endpoints}
    return config

def effective(snapshot):
    # The engine adds allocation/identity fields; retain the actual inputs.
    return replacement(snapshot, snapshot['Image'])

def quiet(command):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=45, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'})
    if result.returncode:
        raise RuntimeError('read-only continuity check failed')
    return result.stdout

def continuity(staging=False, app_available=True):
    prefix = 'hb-live-staging' if staging else 'beacon'
    database_env = env_map(inspect(prefix + '-postgres')['Config'])
    rows = quiet(['docker', 'exec', prefix + '-postgres', 'psql',
                  '-v', 'ON_ERROR_STOP=1', '-U', database_env['POSTGRES_USER'],
                  '-d', database_env['POSTGRES_DB'], '-Atqc',
                  "SELECT count(*) FROM scheduled_sessions WHERE status = 'LIVE'"])
    if rows.strip() != b'0':
        raise RuntimeError('a LIVE session exists')
    app = inspect(prefix + '-app')
    if app is None:
        app = json.loads((ROOT / ('staging' if staging else 'production') / 'prior.json').read_text())['app']
    environment = env_map(app['Config'])
    port = '43880' if staging else '7880'
    def request(method, grant, body):
        def encoded(value):
            return base64.urlsafe_b64encode(canonical(value)).rstrip(b'=').decode()
        unsigned = encoded({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encoded({
            'iss': environment['LIVEKIT_API_KEY'], 'nbf': int(time.time()) - 5,
            'exp': int(time.time()) + 30, 'video': grant})
        signature = hmac.new(environment['LIVEKIT_API_SECRET'].encode(), unsigned.encode(), hashlib.sha256).digest()
        token = unsigned + '.' + base64.urlsafe_b64encode(signature).rstrip(b'=').decode()
        req = Request('http://127.0.0.1:' + port + '/twirp/livekit.RoomService/' + method,
                      data=canonical(body), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        with urlopen(req, timeout=5) as response:
            return json.load(response)
    rooms = request('ListRooms', {'roomList': True}, {}).get('rooms', [])
    for room in rooms:
        name = room['name']
        participants = request('ListParticipants', {'room': name, 'roomAdmin': True}, {'room': name}).get('participants', [])
        for participant in participants:
            if name != ('staging-beacon' if staging else 'beacon') or participant['identity'] != 'playlist-bot':
                raise RuntimeError('active participant prevents replacement')


def health(names, expected_source, origin):
    for attempt in range(75):
        try:
            states = {service: (inspect(name) or {}).get('State', {}) for service, name in names.items()}
            healthy = all(state.get('Running') and (state.get('Health', {}).get('Status') == 'healthy'
                          or (service == 'playlist-bot' and 'Health' not in state))
                          for service, state in states.items())
            if healthy:
                quiet(['docker', 'exec', names['playlist-bot'], 'node', '-e',
                       "const t=Number(require('fs').readFileSync('/tmp/playlist-bot-heartbeat','utf8'));if(!Number.isFinite(t)||Date.now()-t>60000)process.exit(1)"])
            with urlopen(origin + '/api/health', timeout=3) as response:
                body = json.load(response)
            with urlopen(origin + '/api/health/ready', timeout=3) as response:
                ready = response.status == 200
            if healthy and ready and body.get('gitSha') == expected_source:
                return
        except (OSError, ValueError, RuntimeError, http.client.HTTPException):
            pass
        time.sleep(2)
    raise RuntimeError('exact image health/readiness failed')

def boundary(staging):
    if staging:
        return
    network = api('GET', '/networks/pmp_beacon_internal')
    if not network['Internal'] or sorted(x['Name'] for x in network['Containers'].values()) != [
            'beacon-app', 'pmp-myth-worker', 'pmp-myth-worker-secondary']:
        raise RuntimeError('private commerce boundary changed')

def owned(current, snapshots, state, service):
    if current['Id'] in (snapshots[service]['Id'], state['created'].get(service)):
        return True
    if current['Config'].get('Labels', {}).get('com.harmonicbeacon.media-release-590') != state['priorDigest']:
        return False
    # Recover the create-before-journal window only for the precise intended
    # container, not just a matching name/label/image. Docker supplies additional
    # defaults, so compare every explicitly submitted config/host/network field.
    intent = state.get('intents', {}).get(service)
    if not intent or current['Image'] != intent['Image']:
        return False
    for key, value in intent.items():
        if key in ('HostConfig', 'NetworkingConfig', 'Image'):
            continue
        if current['Config'].get(key) != value:
            return False
    for key, value in intent['HostConfig'].items():
        if current['HostConfig'].get(key) != value:
            return False
    actual_networks = current['NetworkSettings']['Networks']
    expected_networks = intent['NetworkingConfig']['EndpointsConfig']
    return set(actual_networks) == set(expected_networks) and all(
        set(endpoint['Aliases']).issubset(set(actual_networks[name].get('Aliases') or []))
        for name, endpoint in expected_networks.items())

def replace(name, payload, snapshots, state, service):
    current = inspect(name)
    if current:
        if not owned(current, snapshots, state, service):
            raise RuntimeError('container identity changed concurrently')
        api('POST', '/containers/' + current['Id'] + '/stop?t=30')
        api('DELETE', '/containers/' + current['Id'])
    created = api('POST', '/containers/create?name=' + quote(name, safe=''), payload)
    # Persist identity before start so a failed start remains recoverable.
    return created['Id']

def safe_path(path, directory=False):
    current = path
    while True:
        info = current.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise RuntimeError('root custody check failed')
        if current == path and not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
            raise RuntimeError('unexpected file type')
        if current == Path('/'):
            return
        current = current.parent

def operate(verb, staging):
    names = {service: ('hb-live-staging-' if staging else 'beacon-') + service for service in IMAGES}
    origin = 'http://127.0.0.1:' + ('3200' if staging else '3000')
    directory = ROOT / ('staging' if staging else 'production')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    safe_path(directory, True)
    state_path = directory / 'state.json'
    prior_path = directory / 'prior.json'
    candidate_index = 0 if staging else 1
    targets = {s: 'sha256:' + values[candidate_index] for s, values in IMAGES.items()}
    before = {s: inspect(name) for s, name in names.items()}
    if verb == 'status':
        print(json.dumps({'images': {s: d['Image'] if d else None for s, d in before.items()},
                          'phase': json.loads(state_path.read_text())['phase'] if state_path.exists() else None}))
        return
    if verb == 'prepare':
        if state_path.exists() or prior_path.exists():
            raise RuntimeError('transaction already exists')
        for service, snapshot in before.items():
            if not snapshot or snapshot['Image'] != 'sha256:' + IMAGES[service][1 - candidate_index]:
                raise RuntimeError('unexpected base image')
            replacement(snapshot, targets[service], api('GET', '/images/' + targets[service] + '/json')['Config'])
        continuity(staging)
        boundary(staging)
        save(prior_path, before)
        save(state_path, {'phase': 'prepared', 'priorDigest': digest(before), 'created': {},
                          'helperSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                          'source': SOURCE, 'targets': targets})
        print('prepared: three fixed images; effective configuration retained')
        return
    safe_path(prior_path)
    safe_path(state_path)
    snapshots = json.loads(prior_path.read_text())
    state = json.loads(state_path.read_text())
    if state['priorDigest'] != digest(snapshots) or state['targets'] != targets or state['helperSha256'] != hashlib.sha256(Path(__file__).read_bytes()).hexdigest():
        raise RuntimeError('transaction bytes changed')
    if verb == 'refresh-provenance':
        if staging or state['phase'] != 'applied':
            raise RuntimeError('provenance refresh requires applied production transaction')
        continuity(False)
        for service, name in names.items():
            current = inspect(name)
            if not current or current['Id'] != state['created'][service] or current['Image'] != targets[service]:
                raise RuntimeError('production changed before provenance refresh')
        # Only repair image metadata, never configuration or source. The normal
        # release updated Env provenance, but an inherited OCI label may be old.
        for service, name in names.items():
            current = inspect(name)
            image_config = api('GET', '/images/' + current['Image'] + '/json')['Config']
            payload = replacement(current, current['Image'], image_config)
            if payload['Labels'] == current['Config']['Labels']:
                continue
            if service != 'app':
                raise RuntimeError('this repair admits only the app provenance label')
            state['phase'] = 'applying'
            state.setdefault('intents', {})[service] = payload
            save(state_path, state)
            api('POST', '/containers/' + current['Id'] + '/stop?t=30')
            continuity(False, app_available=False)
            created = replace(name, payload, snapshots, state, service)
            state['created'][service] = created
            save(state_path, state)
            api('POST', '/containers/' + created + '/start')
        health(names, SOURCE, origin)
        boundary(False)
        state['phase'] = 'applied'
        state['provenanceLabelsVerified'] = True
        save(state_path, state)
        print('exact candidate provenance labels verified; image/config unchanged')
        return
    restoring = verb in ('rollback', 'recover')
    if not restoring and state['phase'] != 'prepared':
        raise RuntimeError('apply requires prepared transaction')
    if restoring and state['phase'] not in ('applied', 'applying', 'restoring', 'recovery-required'):
        raise RuntimeError('no recoverable transaction')
    if not restoring:
        for service, snapshot in snapshots.items():
            if not before[service] or before[service]['Id'] != snapshot['Id'] or effective(before[service]) != effective(snapshot):
                raise RuntimeError('effective base changed')
    continuity(staging, app_available=bool(before['app'] and before['app']['State']['Running']))
    state['phase'] = 'restoring' if restoring else 'applying'
    save(state_path, state)
    try:
        app = inspect(names['app'])
        if app:
            if not owned(app, snapshots, state, 'app'):
                raise RuntimeError('app identity changed')
            api('POST', '/containers/' + app['Id'] + '/stop?t=30')
        continuity(staging, app_available=False)
        for service in ('tapestry', 'playlist-bot', 'app'):
            snapshot = snapshots[service]
            image = snapshot['Image'] if restoring else targets[service]
            image_config = None if restoring else api('GET', '/images/' + image + '/json')['Config']
            payload = replacement(snapshot, image, image_config)
            if staging and not restoring and service == 'tapestry':
                environment = env_map(payload)
                environment['TAPESTRY_SESSION_IDS'] = 'hb590-legacy-recovery'
                payload['Env'] = [key + '=' + value for key, value in environment.items()]
            payload.setdefault('Labels', {})['com.harmonicbeacon.media-release-590'] = state['priorDigest']
            # Admit an existing interrupted create before replacing the intent.
            current = inspect(names[service])
            if current and not owned(current, snapshots, state, service):
                raise RuntimeError('unexpected container at recovery target')
            if current:
                state['created'][service] = current['Id']
            state.setdefault('intents', {})[service] = payload
            save(state_path, state)
            created = replace(names[service], payload, snapshots, state, service)
            state['created'][service] = created
            save(state_path, state)
            api('POST', '/containers/' + created + '/start')
        expected = env_map(snapshots['app']['Config'])['BEACON_GIT_SHA'] if restoring else (PRIOR_SOURCE if staging else SOURCE)
        health(names, expected, origin)
        boundary(staging)
        for service, name in names.items():
            if inspect(name)['Image'] != (snapshots[service]['Image'] if restoring else targets[service]):
                raise RuntimeError('image readback failed')
        state['phase'] = 'rolled-back' if restoring else 'applied'
        save(state_path, state)
        print(json.dumps({'phase': state['phase'], 'source': expected, 'images': {s: inspect(n)['Image'] for s, n in names.items()}}))
    except Exception:
        state['phase'] = 'recovery-required'
        save(state_path, state)
        if not restoring:
            operate('recover', staging)
        raise

def main():
    if os.geteuid() != 0 or len(sys.argv) != 3 or sys.argv[1] not in ('staging', 'production') or sys.argv[2] not in ('prepare', 'apply', 'rollback', 'recover', 'status', 'refresh-provenance'):
        raise RuntimeError('usage (root only): hb-live-media-release.py staging|production prepare|apply|rollback|recover|status|refresh-provenance')
    os.umask(0o077)
    safe_path(Path(__file__).resolve())
    # Same mutex as both installed application/migration bridges.
    path = Path('/var/lib/harmonic-beacon/app-bridge/operation.lock')
    safe_path(path)
    with open(path, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        operate(sys.argv[2], sys.argv[1] == 'staging')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never expose Docker config/environment/response bodies.
        print('media release stopped: ' + str(error) if isinstance(error, RuntimeError) else 'media release stopped; inspect root-only transaction', file=sys.stderr)
        sys.exit(1)
