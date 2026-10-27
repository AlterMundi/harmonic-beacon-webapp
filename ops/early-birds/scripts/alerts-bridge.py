#!/usr/bin/env python3
"""Finite Prometheus-to-Daimon Alerts projection. Never repairs or runs models."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import sqlite3
import subprocess
import time

from client import Client, private_text

RUNBOOK = 'https://github.com/AlterMundi/harmonic-beacon-webapp/blob/early-birds/ops/early-birds/runbook/README.md'
REMOTE = """import urllib.request,json
data={}
for key,path in [('rules','rules?type=alert'),('alerts','alerts')]:
 with urllib.request.urlopen('http://127.0.0.1:9090/api/v1/'+path,timeout=8) as r:
  b=r.read(1048577)
  if len(b)>1048576:raise ValueError('bounded response required')
  data[key]=json.loads(b)
print(json.dumps(data))
"""


def qualify_rules(response, policy, now):
    if response.get('status') != 'success':
        raise ValueError('rule inventory unavailable')
    groups = response.get('data', {}).get('groups')
    if not isinstance(groups, list) or len(groups) > 64:
        raise ValueError('bounded rule inventory required')
    rules = [r for g in groups for r in g['rules']]
    if len(rules) != len(policy) or {r['name'] for r in rules} != set(policy):
        raise ValueError('exact reviewed rule inventory required')
    for rule in rules:
        observed = dt.datetime.fromisoformat(rule['lastEvaluation'].replace('Z', '+00:00')).timestamp()
        if rule.get('health') != 'ok' or rule.get('lastError') or not -60 <= now - observed <= 300:
            raise ValueError('fresh successful rule evaluation required')


def project(response, policy):
    if response.get('status') != 'success' or not isinstance(response.get('data', {}).get('alerts'), list):
        raise ValueError('complete successful observation required')
    rows = response['data']['alerts']
    if len(rows) > 256:
        raise ValueError('bounded alert count required')
    result = {}
    for row in rows:
        labels = row['labels']
        name = labels['alertname']
        if name not in policy or row['state'] not in ('pending', 'firing'):
            raise ValueError('unqualified rule or state requires operator review')
        if row['state'] == 'pending':
            continue
        if len(labels) > 32 or any(not isinstance(v, str) or len(v) > 512 for v in labels.values()):
            raise ValueError('bounded labels required')
        service = labels.get('service', 'platform')
        if not re.fullmatch('[A-Za-z0-9_-]{1,70}', service):
            raise ValueError('safe service identifier required')
        domain = labels.get('domain', '')
        if domain and not re.fullmatch(r'[a-z0-9.-]{1,253}', domain):
            raise ValueError('safe public certificate name required')
        # Private instance labels never enter notices, action text or the journal.
        key = hashlib.sha256(json.dumps(labels, sort_keys=True).encode()).hexdigest()
        severity = 'error' if policy[name] == 'critical' else 'warning'
        code = ('storage_pressure' if 'Disk' in name else
                'observation_unreadable' if 'Monitor' in name or 'Probe' in name else
                'service_unavailable')
        result[key] = dict(name=name, service=service, severity=severity, code=code, domain=domain)
    return result


class Bridge:
    def __init__(self, config, client=None):
        self.config = config
        root = Path(config['state_dir'])
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        st = root.lstat()
        if root.is_symlink() or st.st_uid != os.getuid() or st.st_mode & 0o077:
            raise ValueError('owner-private state required')
        self.lock = (root / 'lock').open('a+b')
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.db = sqlite3.connect(root / 'projection.sqlite')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('CREATE TABLE IF NOT EXISTS incidents(k TEXT PRIMARY KEY,v TEXT);'
                             'CREATE TABLE IF NOT EXISTS outbox(n INTEGER PRIMARY KEY,v TEXT);'
                             'CREATE TABLE IF NOT EXISTS binding(v TEXT);')
        binding = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
        old = self.db.execute('SELECT v FROM binding').fetchone()
        if old and old[0] != binding:
            raise ValueError('explicit binding reconciliation required')
        if not old:
            with self.db:
                self.db.execute('INSERT INTO binding VALUES(?)', (binding,))
        self.client = client or Client(config['base_url'], config['token_file'])

    def close(self):
        self.db.close()
        self.lock.close()

    def flush(self):
        for n, raw in self.db.execute('SELECT n,v FROM outbox ORDER BY n').fetchall():
            value = json.loads(raw)
            result = self.client.call('PUT', '/v1/incidents/' + value['producer_id'] + '/' + value['incident_id'], value)
            if any(result.get(k) != value[k] for k in ('producer_id', 'incident_id', 'revision')):
                raise ValueError('acceptance mismatch')
            with self.db:
                self.db.execute('DELETE FROM outbox WHERE n=?', (n,))

    def observe(self, active, now):
        # Finish uncertain publication before generating any later revision.
        self.flush()
        prior = {k: json.loads(v) for k, v in self.db.execute('SELECT k,v FROM incidents')}
        with self.db:
            for key in set(prior) | set(active):
                old, row = prior.get(key), active.get(key)
                if not row and (not old or old['processing_state'] == 'resolved'):
                    continue
                if row and old and old['processing_state'] == 'open':
                    continue
                if row:
                    value = dict(schema='daimon-alerts/v1', producer_id=self.config['producer_id'],
                                 receiving_scope=self.config['receiving_scope'],
                                 resource_ref='repo-altermundi-harmonic-beacon-webapp',
                                 incident_id='beacon-' + secrets.token_hex(12), operation_id='rule-' + key,
                                 revision=1, phase='availability', problem_code=row['code'],
                                 severity=row['severity'], processing_state='open',
                                 summary=(row['name'] + ' (' + row['service'] +
                                          ('/' + row.get('domain', '') if row.get('domain') else '') + ', Mona).')[:280],
                                 action='CompAII owns follow-up in Beacon Operation. Inspect the named rule and bounded diagnostics; recover only its affected service. Verify this incident resolves after source recovery. Runbook: ' + RUNBOOK,
                                 source_at=now, updated_at=now, work_preserved=True)
                else:
                    value = dict(old, revision=old['revision'] + 1, updated_at=max(now, old['updated_at']),
                                 processing_state='resolved', severity='info',
                                 summary=old['summary'] + ' Source rule recovered.')
                raw = json.dumps(value, sort_keys=True)
                self.db.execute('INSERT OR REPLACE INTO incidents VALUES(?,?)', (key, raw))
                self.db.execute('INSERT INTO outbox(v) VALUES(?)', (raw,))
        self.flush()

    def heartbeat(self, healthy):
        self.client.call('PUT', '/v1/observers/' + self.config['observer_id'],
                         dict(receiving_scope=self.config['receiving_scope'], source_at=int(time.time()),
                              source_state='healthy' if healthy else 'observation_unreadable'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads(private_text(args.config))
    policy = json.loads(Path(config['policy_file']).read_text())
    bridge = Bridge(config)
    try:
        result = subprocess.run(['/usr/bin/ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
                                 config['ssh_target'], 'python3 -c ' + shlex.quote(REMOTE)],
                                capture_output=True, timeout=20, check=True)
        response = json.loads(result.stdout)
        qualify_rules(response['rules'], policy, int(time.time()))
        active = project(response['alerts'], policy)
        bridge.observe(active, int(time.time()))
        bridge.heartbeat(True)
        print(json.dumps(dict(observed=True, firing=len(active))))
    except Exception:
        # Missing source cannot resolve old work; freshness is independently visible.
        try:
            bridge.heartbeat(False)
        except Exception:
            pass
        print('Beacon observation unavailable; retained work preserved.')
        return 1
    finally:
        bridge.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
