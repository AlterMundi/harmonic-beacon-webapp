#!/usr/bin/env python3
"""Operator-only read-only export. Never prints profiles or remote errors.

Run as root on inference after recording verified Live deployment coverage.
The coverage receipt is private JSON: release_sha, coverage_started_at.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import tempfile

CUTOFF = '2026-09-23T22:00:00Z'
ISSUER = 'https://account.harmonicbeacon.com'
DESTINATION = Path('/mnt/m2-1TB/PMP-GPT/.runtime/beacon-auth/operator-import/beacon-live-observed.json')
QUERY_PREFIX = """
const {Pool}=require('/app/node_modules/pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
(async()=>{const db=await pool.connect();try{
await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
await db.query("SET LOCAL statement_timeout='10000ms'");
"""
QUERY_SUFFIX = """
await db.query('COMMIT');process.stdout.write(JSON.stringify(result.rows));
}finally{db.release();}})().catch(()=>{process.exitCode=1;}).finally(()=>pool.end());
"""
VISITS = QUERY_PREFIX + """
const result=await db.query(`SELECT metadata->>'issuer' AS issuer,
metadata->>'subject' AS subject, min(created_at) AS first_seen_at,
max(created_at) AS last_seen_at,
array_agg(DISTINCT metadata->>'surface' ORDER BY metadata->>'surface') AS surfaces
FROM audit_logs WHERE action='pmp_cohort_authenticated_visit_v2'
AND created_at >= $1 AND metadata->>'issuer'=$2
GROUP BY metadata->>'issuer',metadata->>'subject' LIMIT 10001`,
['2026-09-23T22:00:00Z','https://account.harmonicbeacon.com']);
""" + QUERY_SUFFIX


def remote(container, code, payload=b''):
    result = subprocess.run([
        'ssh', '-i', '/root/.ssh/pmp_myth_vps_ed25519', '-o', 'IdentitiesOnly=yes',
        '-o', 'BatchMode=yes', 'debian@mona.altermundi.net',
        'sudo -n docker exec -i ' + shlex.quote(container) + ' node -e ' + shlex.quote(code),
    ], input=payload, capture_output=True, timeout=45)
    if result.returncode:
        raise RuntimeError('remote read failed')
    return json.loads(result.stdout)


def snapshot(visits, profiles, coverage, now):
    if len(visits) > 10000:
        raise ValueError('observation bound exceeded')
    indexed = {r['subject']: r for r in profiles}
    accounts = []
    seen = set()
    for visit in visits:
        key = (visit['issuer'], visit['subject'])
        if key in seen or key[0] != ISSUER or not key[1]:
            raise ValueError('invalid observation identity')
        seen.add(key)
        first = dt.datetime.fromisoformat(visit['first_seen_at'].replace('Z', '+00:00'))
        last = dt.datetime.fromisoformat(visit['last_seen_at'].replace('Z', '+00:00'))
        if not dt.datetime.fromisoformat(CUTOFF.replace('Z', '+00:00')) <= first <= last <= now:
            raise ValueError('invalid observation time')
        if not visit['surfaces'] or not set(visit['surfaces']) <= {'landing', 'session'}:
            raise ValueError('invalid surface')
        profile = indexed.get(key[1])
        if profile is None:
            profile = dict(name=None, preferred_name=None, email=None,
                           email_verified=False, profile_complete=False,
                           review_flags=['account_not_found'])
        accounts.append({**visit, **{k: profile[k] for k in (
            'name', 'preferred_name', 'email', 'email_verified', 'profile_complete', 'review_flags')}})
    accounts.sort(key=lambda r: (r['first_seen_at'], r['issuer'], r['subject']))
    return dict(schema_version='beacon-live-observed-accounts.v2',
                generated_at=now.isoformat(), cutoff=CUTOFF,
                coverage_started_at=coverage['coverage_started_at'],
                source=dict(service='beacon-live', origin='https://live.harmonicbeacon.com',
                            status='active', release_sha=coverage['release_sha']),
                selection_required=True, accounts=accounts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--coverage-receipt', required=True, type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('root required for private destination')
    receipt = args.coverage_receipt
    if receipt.is_symlink() or receipt.stat().st_uid != 0 or stat.S_IMODE(receipt.stat().st_mode) != 0o600:
        raise ValueError('invalid private receipt')
    coverage = json.loads(receipt.read_text())
    if not re.fullmatch(r'[0-9a-f]{40}', coverage['release_sha']):
        raise ValueError('invalid release')
    start = dt.datetime.fromisoformat(coverage['coverage_started_at'].replace('Z', '+00:00'))
    if start.tzinfo is None or start > dt.datetime.now(dt.timezone.utc):
        raise ValueError('invalid coverage')
    # Prove this is still the reviewed runtime, not merely an old local receipt.
    health = remote('beacon-app', "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(r=>process.stdout.write(JSON.stringify({gitSha:r.gitSha}))).catch(()=>process.exit(1))")
    if health.get('gitSha') != coverage['release_sha']:
        raise ValueError('runtime release changed')
    visits = remote('beacon-app', VISITS)
    subjects = [r['subject'] for r in visits]
    if len(subjects) > 10000:
        raise ValueError('observation bound exceeded')
    profiles = []
    if subjects:
        code = "const ids=JSON.parse(require('fs').readFileSync(0,'utf8'));\n" + QUERY_PREFIX + """
const authority=await db.query("SELECT issuer FROM beacon_account_authority_environment WHERE id='authority'");
if(authority.rows[0]?.issuer!=='https://account.harmonicbeacon.com')throw Error('issuer');
const result=await db.query(`SELECT u.id AS subject, coalesce(p.display_name,u.name) AS name,
p.display_name AS preferred_name,u.email,u.email_verified,
(p.display_name IS NOT NULL AND length(trim(p.display_name))>0 AND
p.real_name IS NOT NULL AND length(trim(p.real_name))>0) AS profile_complete
FROM early_bird_users u LEFT JOIN beacon_profiles p ON p.account_id=u.id
WHERE u.id=ANY($1::text[])`,[ids]);
for(const r of result.rows){r.review_flags=[];
if(!r.email_verified)r.review_flags.push('email_unverified');
if(!r.profile_complete)r.review_flags.push('profile_incomplete');
if(/(^|\\.)(invalid|test|example\\.com|example\\.org|example\\.net)$/.test(r.email.split('@').pop().toLowerCase()))r.review_flags.push('reserved_email_domain');}
""" + QUERY_SUFFIX
        profiles = remote('beacon-account-account-production-1', code, json.dumps(subjects).encode())
    data = snapshot(visits, profiles, coverage, dt.datetime.now(dt.timezone.utc))
    for parent in (DESTINATION.parent.parent, DESTINATION.parent):
        if parent.is_symlink() or not parent.is_dir() or parent.stat().st_uid != 0 or stat.S_IMODE(parent.stat().st_mode) != 0o700:
            raise ValueError('private destination missing')
    if DESTINATION.is_symlink():
        raise ValueError('unsafe destination')
    payload = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()
    fd, temporary = tempfile.mkstemp(prefix='.live-observed-', dir=DESTINATION.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, DESTINATION)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(json.dumps(dict(path=str(DESTINATION), accounts=len(data['accounts']),
                         generated_at=data['generated_at'], sha256=hashlib.sha256(payload).hexdigest(),
                         coverage_started_at=coverage['coverage_started_at'], enrolments_created=0)))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Export failed; prior snapshot preserved; private error details withheld')
