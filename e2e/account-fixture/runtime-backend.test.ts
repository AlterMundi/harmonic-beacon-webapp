import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

test('clean runtime env carries CI and capped heap, rejects secrets and validates same-user private Pulse socket', async () => {
    const backend = await load();
    assert.equal(typeof backend.runtimeEnv, 'function');
    const dir = await mkdtemp(path.join(tmpdir(), 'account-pulse-test-'));
    const socket = path.join(dir, 'audio.sock');
    const server = createServer();
    await new Promise<void>(resolve => server.listen(socket, resolve));
    try {
        const source = { PATH: '/usr/bin', HOME: dir, CI: 'true', NEXT_PUBLIC_E2E_CONTINUITY_OBSERVER: '1', NODE_OPTIONS: '--require /secret.js --max-old-space-size=9000', DATABASE_URL: 'production', AWS_SECRET_ACCESS_KEY: 'secret', UNRELATED_INHERITED_VARIABLE: 'strip-me', PULSE_SERVER: `unix:${socket}`, E2E_ACCOUNT_PULSE_DIR: dir };
        const env = await backend.runtimeEnv(source, dir);
        assert.equal(env.CI, '1');
        assert.equal(env.NEXT_PUBLIC_E2E_CONTINUITY_OBSERVER, '1');
        assert.equal(env.NODE_OPTIONS, '--max-old-space-size=2048');
        assert.equal(env.PULSE_SERVER, `unix:${socket}`);
        assert.equal(env.DATABASE_URL, undefined); assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined); assert.equal(env.UNRELATED_INHERITED_VARIABLE, undefined);
        assert.equal((await backend.runtimeEnv({ ...source, NEXT_PUBLIC_E2E_CONTINUITY_OBSERVER: 'true' }, dir)).NEXT_PUBLIC_E2E_CONTINUITY_OBSERVER, undefined);
        for (const bad of ['tcp:127.0.0.1', 'unix:/run/pulse/native', `unix:${socket} unix:/run/other`]) {
            await assert.rejects(backend.runtimeEnv({ ...source, PULSE_SERVER: bad }, dir), /Pulse/);
        }
        await assert.rejects(backend.runtimeEnv({ ...source, E2E_ACCOUNT_PULSE_DIR: undefined }, dir), /Pulse/);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});

test('native backend initializes exclusive PG16.15 cluster, private DB and owned LiveKit1.13.4 without Docker or loopback RTC override', async () => {
    const backend = await load();
    assert.equal(typeof backend.startNativeBackend, 'function');
    const dir = await mkdtemp(path.join(tmpdir(), 'account-native-test-'));
    const calls: Array<{ exe: string; args: string[]; input?: string }> = [];
    let waited = '';
    const io = {
        run: async (exe: string, args: string[], input?: string) => { calls.push({ exe, args, input }); },
        capture: async (exe: string, args: string[]) => { calls.push({ exe, args }); return exe.endsWith('livekit-server') ? 'livekit-server version 1.13.4' : `${path.basename(exe)} (PostgreSQL) 16.15`; },
        start: (exe: string, args: string[]) => { calls.push({ exe, args }); return { alive: () => true }; },
        waitPostgres: async (url: string, data: string) => { waited = data; assert.equal(new URL(url).pathname, '/postgres'); },
    };
    try {
        const options = { dir, uid: 1000, pgBin: '/usr/lib/postgresql/16/bin', livekitBin: '/usr/local/bin/livekit-server' };
        const stack = await backend.startNativeBackend(options, io);
        assert.equal(waited, path.join(dir, 'pgdata'));
        const url = new URL(stack.databaseUrl);
        assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '35432'); assert.equal(url.pathname, '/beacon_test'); assert.ok(url.password.length >= 32);
        assert.ok(calls.some(c => c.exe.endsWith('/initdb') && c.args.includes('--auth-host=scram-sha-256')));
        assert.ok(calls.some(c => c.exe.endsWith('/postgres') && c.args.includes('listen_addresses=127.0.0.1')));
        assert.ok(calls.some(c => c.exe.endsWith('/psql') && c.args.includes('CREATE DATABASE beacon_test')));
        await stack.restore('SELECT 123;');
        assert.ok(calls.some(c => c.exe.endsWith('/psql') && c.args.includes('-X') && c.input?.includes('SELECT 123;') && c.input.includes('CURRENT_TIMESTAMP')));
        const config = await readFile(path.join(dir, 'livekit.yaml'), 'utf8');
        assert.match(config, /tcp_port: 34881/); assert.match(config, /port_range_start: 34900/); assert.doesNotMatch(config, /node_ip/);
        assert.ok(calls.some(c => c.exe === options.livekitBin && c.args.includes('--config')));
        assert.ok(!calls.some(c => c.exe === 'docker'));
        const count = calls.length;
        await assert.rejects(backend.startNativeBackend(options, io), /EEXIST/);
        assert.equal(calls.length, count + 5, 'versions may be checked again, but existing data must never be started');
        await assert.rejects(backend.startNativeBackend({ ...options, uid: 0 }, io), /unprivileged/);
        await assert.rejects(backend.startNativeBackend({ ...options, dir: path.join(dir, 'wrong') }, { ...io, capture: async () => 'version 99' }), /version/);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('owned command adapter bounds failures and terminates stubborn process groups including grandchildren', async () => {
    const backend = await load(); assert.equal(typeof backend.commandAdapter, 'function');
    const dir = await mkdtemp(path.join(tmpdir(), 'account-process-test-'));
    const io = backend.commandAdapter(dir, { PATH: process.env.PATH, NODE_ENV: 'production' }, dir, 200);
    try {
        assert.equal((await io.capture(process.execPath, ['-e', 'console.log("version evidence")'])).trim(), 'version evidence');
        await assert.rejects(io.run(process.execPath, ['-e', 'process.exit(7)']), /exited 7/);
        await assert.rejects(io.run('/nonexistent/account-fixture-bin', []), /ENOENT/);
        await assert.rejects(io.run(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], undefined, 200), /timed out/);
        const pidfile = path.join(dir, 'grandchild');
        io.start(process.execPath, ['-e', `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(pidfile)},String(child.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`]);
        let pid = 0;
        for (let i = 0; i < 100 && !pid; i++) { try { pid = Number(await readFile(pidfile, 'utf8')); } catch { await new Promise(r => setTimeout(r, 10)); } }
        assert.ok(pid > 0);
        await io.stopAll();
        // A killed grandchild may briefly be a zombie under container PID1; it
        // must not be runnable. Do not send signals to arbitrary discovered PIDs.
        try { assert.equal((await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ')[2], 'Z'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    } finally { await io.stopAll(); await rm(dir, { recursive: true, force: true }); }
});

test('server cleanup explicitly destroys upgraded websocket sockets', async () => {
    const backend = await load(); assert.equal(typeof backend.trackConnections, 'function');
    const { createServer: httpServer } = await import('node:http'); const { connect } = await import('node:net');
    const server = httpServer(); const tracked = backend.trackConnections(server);
    server.on('upgrade', (_req, socket) => socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = connect((server.address() as { port: number }).port, '127.0.0.1');
    client.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    await new Promise(resolve => client.once('data', resolve));
    await tracked.close(); client.destroy(); assert.equal(server.listening, false);
});

test('port conflicts fail closed; owned Postgres readiness rejects a different data directory and closes probes', async () => {
    const backend = await load(); assert.equal(typeof backend.assertPortsFree, 'function'); assert.equal(typeof backend.waitForPostgres, 'function');
    const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try { await assert.rejects(backend.assertPortsFree([(server.address() as { port: number }).port], []), /EADDRINUSE/); }
    finally { await new Promise<void>(r => server.close(() => r())); }
    let ends = 0;
    const probe = () => ({ connect: async () => {}, query: async () => ({ rows: [{ data_directory: '/shared' }] }), end: async () => { ends++; } });
    await assert.rejects(backend.waitForPostgres('postgresql://unused', '/owned', { alive: () => true }, probe), /ownership/);
    assert.equal(ends, 1);
    await assert.rejects(backend.waitForPostgres('postgresql://unused', '/owned', { alive: () => false }, probe), /exited/);
    assert.equal(ends, 1, 'never probe an exited server');
});

test('Docker backend remains real Docker, pins LiveKit v1.13.4 and cleans only CID-file-owned containers', async () => {
    const backend = await load(); assert.equal(typeof backend.startDockerBackend, 'function');
    const dir = await mkdtemp(path.join(tmpdir(), 'account-docker-test-'));
    const calls: Array<{ exe: string; args: string[] }> = []; const closes: Array<() => Promise<void>> = [];
    const io = {
        run: async (exe: string, args: string[]) => { calls.push({ exe, args }); if (args.includes('--cidfile')) await writeFile(args[args.indexOf('--cidfile') + 1], 'a'.repeat(64)); },
        capture: async (exe: string, args: string[]) => { calls.push({ exe, args }); return 'isolated adapter image evidence'; },
        start: () => ({ alive: () => true }),
        waitPostgres: async () => {},
    };
    try {
        const stack = await backend.startDockerBackend(dir, io, close => closes.push(close));
        assert.equal(new URL(stack.databaseUrl).pathname, '/beacon_test');
        assert.ok(calls.some(c => c.args.includes('livekit/livekit-server:v1.13.4')));
        assert.ok(!calls.some(c => c.args.includes('livekit/livekit-server:latest')));
        await stack.restore('ignored by Docker loader');
        assert.ok(calls.some(c => c.args.includes('scripts/load-test-fixture.mjs')));
        for (const close of closes) await close();
        assert.equal(calls.filter(c => c.args[0] === 'rm' && c.args[2] === 'a'.repeat(64)).length, 2);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Account matrix covers all four browser projects, CI forbids only and Chromium flags do not bleed into other engines', async () => {
    const old = { ...process.env };
    Object.assign(process.env, { CI: '1', E2E_ACCOUNT_FIXTURE: '1', E2E_ACCOUNT_ISSUER: 'https://127.0.0.1:3411', E2E_BASE_URL: 'https://127.0.0.1:3410', E2E_DATABASE_URL: 'postgresql://postgres:test@127.0.0.1:35432/beacon_test' });
    try {
        const config = (await import('./playwright.config')).default;
        assert.equal(config.forbidOnly, true);
        assert.deepEqual(config.projects?.map(p => p.name), ['chromium-account', 'android-chrome-account', 'firefox-account', 'iphone-webkit-account']);
        for (const project of config.projects!) {
            const launch = project.use?.launchOptions;
            if (project.name!.includes('chrome') || project.name === 'chromium-account') assert.ok(launch?.args?.includes('--use-fake-device-for-media-stream'));
            else { assert.equal(launch?.executablePath, undefined); assert.deepEqual(launch?.args, []); }
            const mobile = ['android-chrome-account', 'iphone-webkit-account'].includes(project.name!);
            assert.equal(String(project.grepInvert), mobile ? '/@desktop-native-staff$/' : 'undefined');
            assert.equal(project.testIgnore, undefined);
        }
        assert.equal(config.projects![2].use?.launchOptions?.firefoxUserPrefs?.['media.navigator.streams.fake'], true);
    } finally { for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});

test('owned listener readiness never accepts an unrelated pre-existing app on a port', async () => {
    const backend = await load(); const dir = await mkdtemp(path.join(tmpdir(), 'account-listener-test-'));
    const io = backend.commandAdapter(dir, { PATH: process.env.PATH, NODE_ENV: 'production' }, dir, 200);
    const unrelated = createServer(); await new Promise<void>(r => unrelated.listen(0, '127.0.0.1', r));
    try {
        const owned = io.start(process.execPath, ['-e', 'require("node:net").createServer().listen(0,"127.0.0.1",function(){require("node:fs").writeFileSync("port",String(this.address().port))})']);
        assert.equal(typeof owned.listening, 'function', 'readiness needs owned socket inode, not just HTTP 200');
        let port = 0;
        for (let i = 0; i < 100 && !port; i++) { try { port = Number(await readFile(path.join(dir, 'port'), 'utf8')); } catch { await new Promise(r => setTimeout(r, 10)); } }
        assert.ok(port > 0);
        assert.equal(await owned.listening(port), true);
        assert.equal(await owned.listening((unrelated.address() as { port: number }).port), false);
    } finally { await io.stopAll(); await new Promise<void>(r => unrelated.close(() => r())); await rm(dir, { recursive: true, force: true }); }
});

test('Account collection has exactly 70 applicable memberships; only two desktop-native Staff entries are excluded', async () => {
    const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '-c', 'e2e/account-fixture/playwright.config.ts', '--list', '--reporter=json'], {
        encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, TSX_DISABLE_CACHE: '1', E2E_ACCOUNT_FIXTURE: '1', E2E_ACCOUNT_ISSUER: 'https://127.0.0.1:3411', E2E_BASE_URL: 'https://127.0.0.1:3410', E2E_DATABASE_URL: 'postgresql://postgres:unused@127.0.0.1:35432/beacon_test' },
    });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.deepEqual(report.errors, []);
    type Suite = { suites?: Suite[]; specs?: { title: string; tests: { projectName: string }[] }[] };
    const actual: string[] = [];
    const walk = (suites: Suite[]) => { for (const suite of suites) {
        for (const spec of suite.specs ?? []) for (const test of spec.tests) actual.push(`${test.projectName}: ${spec.title}`);
        walk(suite.suites ?? []);
    } };
    walk(report.suites);
    const common = [
        ...['ATTENDEE', 'OPERATOR', 'FACILITATOR'].map(role => `Account RP ${role}: real callback, entitlement, stale identity revalidation and fail-closed binding`),
        'Account RP rejects a correctly authenticated but unbound staff identity',
        ...['ATTENDEE', 'OPERATOR'].flatMap(role => [
            'denied VIDEO locale changes do not retry capture',
            'locale preserves real LiveKit playback',
            'cancelled exits preserve real media, state and focus',
            'sign-out waits for confirmation and revokes once',
            'server removal dismisses a pending guard without trapping',
            'Back cancellation and native unload retain real playback',
        ].map(suffix => `live continuity without capture: full-stack ${role} ${suffix}`)),
        'live continuity without capture: full-stack ended Staff event releases parent and room guards',
    ];
    const expected = ['chromium-account', 'android-chrome-account', 'firefox-account', 'iphone-webkit-account'].flatMap(project => {
        const titles = [...common];
        if (['chromium-account', 'firefox-account'].includes(project)) titles.push('live continuity without capture: Staff open drawer survives a cancelled browser reload @desktop-native-staff');
        return titles.map(title => `${project}: ${title}`);
    });
    assert.equal(expected.length, 70);
    assert.deepEqual(actual.sort(), expected.sort());
});

// Optional import makes an absent implementation an assertion RED, not a loader error.
const load = async () => await import('./runtime-backend').catch(() => ({})) as typeof import('./runtime-backend');
test('copies nested build inputs recursively, excluding dotenv, outputs and dependency trees', async () => {
    const backend = await load();
    assert.equal(typeof backend.copySource, 'function', 'runner needs a tested recursive isolated copy');
    const dir = await mkdtemp(path.join(tmpdir(), 'account-copy-test-'));
    try {
        const root = path.join(dir, 'source'); const dest = path.join(dir, 'app');
        await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
        await writeFile(path.join(root, 'src', 'nested', 'page.ts'), 'fixture');
        await writeFile(path.join(root, 'src', '.env.local'), 'SECRET');
        await mkdir(path.join(root, '.next'));
        await writeFile(path.join(root, '.next', 'build'), 'stale');
        await backend.copySource(root, dest);
        assert.equal(await readFile(path.join(dest, 'src', 'nested', 'page.ts'), 'utf8'), 'fixture');
        await assert.rejects(readFile(path.join(dest, 'src', '.env.local')), { code: 'ENOENT' });
        await assert.rejects(readFile(path.join(dest, '.next', 'build')), { code: 'ENOENT' });
    } finally { await rm(dir, { recursive: true, force: true }); }
});
