import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

test('observer preserves failures, rejects wrong database targets and emits no event identifiers', () => {
  const script = path.resolve(import.meta.dirname, '../scripts/platform-observer.py');
  execFileSync('python3', ['-B', '-c', `
import importlib.util, json
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('observer', ${JSON.stringify(script)})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with patch.object(m,'http_health',side_effect=TimeoutError), patch.object(m,'backup_time',side_effect=PermissionError), patch.object(m,'unit_health',return_value=(0,123)), patch.object(m,'event_state',side_effect=RuntimeError):
 text=m.collect()
 assert 'beacon_platform_health_up{service="live"} 0' in text
 assert 'beacon_platform_backup_probe_up{service="account"} 0' in text
 assert 'beacon_platform_monitor_up{service="analytics"} 0' in text
 assert 'beacon_platform_event_probe_up{service="live"} 0' in text
 assert 'events_overdue' not in text
with patch.object(m,'command',return_value='wrong:postgres'):
 try: m.event_state();raise AssertionError('wrong target accepted')
 except ValueError: pass
with patch.object(m,'command',side_effect=['app:postgres',json.dumps({'overdue':2,'next':123,'live':0})]) as command:
 assert m.event_state()=={'overdue':2,'next':123,'live':0}
 assert 'BEGIN READ ONLY' in command.call_args.args[1]
 assert 'ON_ERROR_STOP=1' in ' '.join(command.call_args.args[0])
 assert 'public_access AND is_published AND NOT is_test' in m.EVENT_SQL
for value in [-1,float('nan'),'secret',True]:
 with patch.object(m,'command',side_effect=['app:postgres',json.dumps({'overdue':value,'next':123,'live':0})]):
  try: m.event_state();raise AssertionError('invalid aggregate accepted')
  except ValueError: pass
`], { stdio: 'pipe' });
});
