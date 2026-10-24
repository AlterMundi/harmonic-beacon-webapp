import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
const prefix = `import importlib.util,json,struct\ns=importlib.util.spec_from_file_location('op','deploy/hb-operator-root.py')\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n`;
function python(code: string) {
    const r = spawnSync('python3', ['-B', '-c', prefix + code], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0); return JSON.parse(r.stdout);
}
describe('root operator Docker execution boundary', () => {
    it('verifies delegated caller, profile and response boundaries', () => {
        const result = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'deploy', '-p', 'test_operator_access.py'], { encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
    });
    it('uses the exact runtime image in a fresh read-only unprivileged container', () => {
        const result = python(`r={'Id':'target-container','Config':{'Env':['DATABASE_URL=test-only','BEACON_GIT_SHA='+'a'*40,'ACCOUNT_SECRET=must-not-copy','NODE_OPTIONS=must-not-copy']}}\nc=m.container_config(r,'sha256:exact','production','/root/in','/root/out','run')\nprint(json.dumps(c))`);
        expect(result.Image).toBe('sha256:exact');
        expect(result.Entrypoint).toEqual(['node']);
        expect(result.HostConfig).toMatchObject({ ReadonlyRootfs: true, NetworkMode: 'container:target-container', CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'] });
        expect(result.HostConfig.Binds).toEqual(['/root/in:/run/operator-in:ro', '/root/out:/run/operator-out:rw']);
        expect(result.Env).toContain('DATABASE_URL=test-only');
        expect(result.Env.some((x: string) => /ACCOUNT_SECRET|NODE_OPTIONS/.test(x))).toBe(false);
    });
    it('rejects truncated/malformed Docker result framing', () => {
        expect(python(`bad=0\nfor data in [b'x',struct.pack('>BBBBI',1,0,0,0,10)+b'x']:\n try: m.decode_logs(data)\n except RuntimeError: bad+=1\nprint(json.dumps(bad))`)).toBe(2);
    });
});
