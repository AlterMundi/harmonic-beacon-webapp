import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const script = new URL('../../../ops/analytics/restore-verify-analytics.sh', import.meta.url);
const compose = new URL('../../../ops/analytics/compose.synthetic.yml', import.meta.url);
let available = true;
try { execFileSync('docker', ['compose', 'version'], {stdio:'ignore'}); } catch { available = false; }
test('restore profile renders with its actual exports without activating the synthetic collector', {skip:!available}, () => {
 const exported = Object.fromEntries([...readFileSync(script,'utf8').matchAll(/^export (ANALYTICS_SYNTHETIC_[A-Z0-9_]+)='([^']+)'$/gm)].map(m=>[m[1],m[2]]));
 const output=execFileSync('docker',['compose','--env-file','/dev/null','--file',compose.pathname,'--profile','synthetic-restore','config','--format','json'],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME,...exported,ANALYTICS_IMAGE_REF:'ghcr.io/altermundi/harmonic-beacon-analytics:synthetic',ANALYTICS_SYNTHETIC_DATABASE_PASSWORD:'synthetic-test-only'}});
 const config=JSON.parse(output);
 assert.deepEqual(Object.keys(config.services).sort(),['migrate-synthetic','postgres-synthetic']);
 assert.equal(config.networks['synthetic-database'].internal,true);
 assert.ok(!Object.values(config.networks).some(n=>n.external));
});
