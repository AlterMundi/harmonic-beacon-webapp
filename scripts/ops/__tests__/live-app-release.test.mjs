import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('owner-only app release binds one app pair and exact rollback-forward evidence', () => {
 const result=spawnSync('python3',[fileURLToPath(new URL('./live-app-release_test.py',import.meta.url))],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:10000});
 assert.equal(result.status,0,result.stderr);
});
