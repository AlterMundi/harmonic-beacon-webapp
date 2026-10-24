#!/usr/bin/python3 -I
"""Delegate Staff API calls to a Unix operator's root-owned credential profile."""
import fcntl
import base64
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import sys

HELPER = Path('/usr/local/sbin/hb-operator')
POLICY = Path('/etc/harmonic-beacon/operator/access.json')
LOCK = Path('/var/lib/harmonic-beacon/app-bridge/operation.lock')


def response_fields(raw):
    if not raw: return {'body': None, 'responseEncoding': 'empty'}
    try:
        return {'body': json.loads(raw), 'responseEncoding': 'json'}
    except (ValueError, UnicodeError):
        return {'bodyBase64': base64.b64encode(raw).decode('ascii'), 'responseEncoding': 'base64'}


def validate_request(value):
    if not isinstance(value, dict) or not {'expectedSourceSha', 'method', 'apiPath'} <= set(value) or \
            set(value) - {'expectedSourceSha', 'method', 'apiPath', 'body'}:
        raise ValueError('Only a bounded Staff API request is permitted')
    if not isinstance(value['expectedSourceSha'], str) or not re.fullmatch(r'[a-f0-9]{40}', value['expectedSourceSha']):
        raise ValueError('Exact running source revision required')
    path = value['apiPath']
    if value['method'] not in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE') or not isinstance(path, str) or \
            not re.match(r'^/api/(ops|admin)(/|$)', path) or re.search(r'[\\\x00-\x20\x7f%]', path) or '..' in path:
        raise ValueError('Only the existing Staff API is permitted')
    return value


def caller_profile(policy, environment, user, uid):
    grant = policy.get(user)
    if not isinstance(grant, dict) or set(grant) != {'uid', 'operator', 'environments'} or \
            type(grant['uid']) is not int or str(grant['uid']) != str(uid) or \
            not isinstance(grant['operator'], str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,31}', grant['operator']) or \
            environment not in grant['environments']:
        raise ValueError('Unix operator is not authorized for this environment')
    return grant['operator']


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in ('staging', 'production'):
        raise ValueError('Exact environment and reviewed sudo entry required')
    environment = sys.argv[1]
    user, uid = os.environ.get('SUDO_USER'), os.environ.get('SUDO_UID')
    if not user or user == 'root' or str(pwd.getpwnam(user).pw_uid) != uid:
        raise ValueError('Authenticated sudo caller required')
    # Load only the installed root-owned helper. No application imports or caller code.
    for path in (HELPER, POLICY, LOCK):
        current = path
        while True:
            info = current.lstat()
            if info.st_uid != 0 or info.st_mode & 0o022 or current.is_symlink():
                raise ValueError('Unsafe root custody')
            if current == path and (not current.is_file() or info.st_nlink != 1):
                raise ValueError('Unsafe root file')
            if current == Path('/'): break
            current = current.parent
    if POLICY.stat().st_size > 16384 or POLICY.stat().st_mode & 0o777 != 0o600:
        raise ValueError('Unsafe access policy')
    operator = caller_profile(json.loads(POLICY.read_text()), environment, user, uid)
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536: raise ValueError('Request exceeds bound')
    request = validate_request(json.loads(raw))
    loader = importlib.machinery.SourceFileLoader('hb_operator_installed', str(HELPER))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    helper = importlib.util.module_from_spec(spec)
    loader.exec_module(helper)
    with LOCK.open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        profile = helper.profile_directory(environment, operator)
        helper.custody(profile)
        target = profile / 'request.json'
        if target.exists(): helper.custody(target, True)
        body = {**request, 'environment': environment, 'operation': 'request'}
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump(body, output)
        result = helper.operate(environment, operator)
        # The helper generated the run ID and owns this private output. Only this
        # caller's own API response is disclosed; credentials and other runs stay private.
        response = helper.STATE / result['runId'] / 'output' / 'response'
        helper.custody(response, True)
        if response.stat().st_size > 1048576: raise ValueError('Response exceeds bound')
        result.update(response_fields(response.read_bytes()))
        print(json.dumps(result))


if __name__ == '__main__':
    try:
        os.umask(0o077)
        main()
    except Exception:
        print('Beacon Staff request stopped; private operation evidence retained', file=sys.stderr)
        sys.exit(1)
