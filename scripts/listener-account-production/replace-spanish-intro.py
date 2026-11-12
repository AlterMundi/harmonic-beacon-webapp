#!/usr/bin/env python3
"""Install the reviewed Spanish media selection without rebuilding Listener."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def run(*args):
    return subprocess.check_output(args, text=True)


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def main():
    if os.geteuid() != 0 or sys.argv[1:] not in [['staging'], ['production']]:
        raise SystemExit('usage (root): replace-spanish-intro.py staging|production')
    staging = sys.argv[1] == 'staging'
    name = 'listener-identity-staging-app' if staging else 'earlybirds-preview-listener-1'
    lock = '/run/lock/' + ('listener-identity-staging' if staging else 'listener-account-production') + '.lock'
    with open(lock, 'a') as fence:
        fcntl.flock(fence, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = inspect(name)
        assert before['State']['Health']['Status'] == 'healthy'
        labels = before['Config']['Labels']
        deploy = Path(labels['com.docker.compose.project.environment_file'])
        if staging:
            fields = dict(line.split('=', 1) for line in deploy.read_text().splitlines() if '=' in line and not line.startswith('#'))
            env = Path(fields['LISTENER_IDENTITY_STAGING_APP_ENV_FILE'])
        else:
            env = deploy
        assert env.is_file() and not env.is_symlink() and env.stat().st_uid == 0
        manifest = Path(__file__).resolve().parents[2] / 'ops/listener-identity-staging/intro-artifacts.sha256'
        entries = [line.split() for line in manifest.read_text().splitlines() if '-es-' in line]
        assert len(entries) == 1
        digest, relative = entries[0]
        assert relative.startswith('drop-ins/') and '..' not in relative
        mounts = [m for m in before['Mounts'] if m['Destination'] == '/media/artifacts']
        assert len(mounts) == 1 and not mounts[0]['RW']
        artifact = Path(mounts[0]['Source']) / relative
        assert hashlib.sha256(artifact.read_bytes()).hexdigest() == digest
        desired = '/media/artifacts/' + relative
        key = 'EARLY_BIRDS_DROPIN_ES_PATH'
        old = env.read_bytes()
        lines = old.decode().splitlines(keepends=True)
        assert sum(line.startswith(key + '=') for line in lines) == 1
        candidate = ''.join(key + '=' + desired + '\n' if line.startswith(key + '=') else line for line in lines).encode()
        assert candidate != old, 'already selected; inspect receipt instead of replaying'
        compose = ['docker', 'compose', '--env-file', str(deploy), '-p', labels['com.docker.compose.project']]
        for config in labels['com.docker.compose.project.config_files'].split(','):
            compose += ['-f', config]
        service = labels['com.docker.compose.service']
        def config():
            return json.loads(run(*compose, 'config', '--format', 'json'))['services'][service]
        initial = config()
        assert initial['environment'][key] == dict(x.split('=', 1) for x in before['Config']['Env'])[key]
        assert run('docker', 'image', 'inspect', initial['image'], '--format', '{{.Id}}').strip() == before['Image']
        others = {c: inspect(c)['Id'] for c in run('docker', 'ps', '-q').split() if c != before['Id'][:12]}
        state = Path('/var/lib/harmonic-beacon/listener-intro-repair') / (sys.argv[1] + '-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
        state.mkdir(parents=True, mode=0o700)
        os.chmod(state.parent, 0o700)
        (state / 'previous.env').write_bytes(old)
        os.chmod(state / 'previous.env', 0o600)
        def install(data):
            temp = env.with_name(env.name + '.intro-tmp')
            with open(temp, 'xb') as output:
                os.chmod(temp, 0o600)
                output.write(data)
            os.replace(temp, env)
        def recreate():
            run(*compose, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', service)
            for _ in range(60):
                current = inspect(name)
                if current['State'].get('Health', {}).get('Status') == 'healthy':
                    return current
                time.sleep(2)
            raise RuntimeError('Listener did not become healthy')
        try:
            install(candidate)
            updated = config()
            expected = json.loads(json.dumps(initial))
            expected['environment'][key] = desired
            assert updated == expected, 'resolved Compose changed beyond Spanish path'
            after = recreate()
            assert after['Image'] == before['Image']
            expected_env = dict(x.split('=', 1) for x in before['Config']['Env'])
            expected_env[key] = desired
            assert dict(x.split('=', 1) for x in after['Config']['Env']) == expected_env
            assert all(inspect(c)['Id'] == identity for c, identity in others.items())
            receipt = dict(environment=sys.argv[1], image=after['Image'], artifact=relative, sha256=digest, previousContainer=before['Id'], currentContainer=after['Id'], healthy=True, unrelatedContainersPreserved=True)
            (state / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
            print(json.dumps(receipt))
        except BaseException:
            install(old)
            restored = recreate()
            assert restored['Image'] == before['Image']
            print('Previous environment restored and Listener healthy', file=sys.stderr)
            raise


if __name__ == '__main__':
    main()
