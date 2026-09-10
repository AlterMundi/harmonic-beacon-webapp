import { cp, lstat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { readFile, readdir, readlink } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { createServer as tcpServer } from 'node:net';
import { createSocket } from 'node:dgram';
import pg from 'pg';
import path from 'node:path';
import { assertSafeFixtureDatabaseUrl } from '../fixtures/database-url';

type JsonObject = Record<string, unknown>;
const invalidReport = (): never => { throw new Error('Invalid Playwright JSON report'); };
const reportObject = (value: unknown): JsonObject =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : invalidReport();
const reportArray = (value: unknown): unknown[] => Array.isArray(value) ? value : invalidReport();
const reportInteger = (value: unknown): number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalidReport();
const testStatuses = new Set(['expected', 'unexpected', 'flaky', 'skipped']);
const resultStatuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const failureStatuses = new Set(['failed', 'timedOut', 'interrupted']);

function reportLocation(value: unknown): void {
    const location = reportObject(value);
    if (typeof location.file !== 'string') invalidReport();
    reportInteger(location.line);
    reportInteger(location.column);
}

function reportErrors(value: unknown): JsonObject[] {
    return reportArray(value).map(errorValue => {
        const error = reportObject(errorValue);
        if (typeof error.message !== 'string') invalidReport();
        if (error.location !== undefined) reportLocation(error.location);
        return error;
    });
}

function reportTestError(value: unknown, depth = 0): JsonObject {
    if (depth > 16) invalidReport();
    const error = reportObject(value);
    for (const field of ['message', 'snippet', 'stack', 'value']) {
        if (error[field] === undefined) continue;
        if (typeof error[field] !== 'string') invalidReport();
    }
    if (error.location !== undefined) reportLocation(error.location);
    if (error.cause !== undefined) reportTestError(error.cause, depth + 1);
    return error;
}

function reportTestErrors(value: unknown): JsonObject[] {
    return reportArray(value).map(error => reportTestError(error));
}

const publicProjects = new Set(['chromium-account', 'android-chrome-account', 'firefox-account', 'iphone-webkit-account']);
const publicSpecFiles = new Set(['tests/continuity-navigation.spec.ts', 'account-fixture/rp.spec.ts']);
function publicProject(value: unknown): string {
    return typeof value === 'string' && publicProjects.has(value) ? value : '<redacted>';
}

function publicSpecFile(value: unknown): string {
    if (typeof value !== 'string') return '<redacted>';
    const normalized = value.replaceAll('\\', '/').replace(/^e2e\//, '');
    return publicSpecFiles.has(normalized) ? `e2e/${normalized}` : '<redacted>';
}

/** Public CI diagnostics contain only source-controlled identifiers and result state. */
export function summarizePlaywrightFailureReport(value: unknown) {
    const report = reportObject(value);
    const rootErrors = reportTestErrors(report.errors);
    const stats = reportObject(report.stats);
    const unexpected = reportInteger(stats.unexpected);
    const failures: Array<{ project: string; file: string; line: number; column: number; classification: string }> = [];
    const visit = (suiteValue: unknown, depth = 0) => {
        if (depth > 32) invalidReport();
        const suite = reportObject(suiteValue);
        for (const specValue of reportArray(suite.specs)) {
            const spec = reportObject(specValue);
            if (typeof spec.file !== 'string') invalidReport();
            const line = reportInteger(spec.line);
            const column = reportInteger(spec.column);
            for (const testValue of reportArray(spec.tests)) {
                const test = reportObject(testValue);
                if (typeof test.projectName !== 'string' || typeof test.status !== 'string' || !testStatuses.has(test.status)) invalidReport();
                const results = reportArray(test.results).map(resultValue => {
                    const result = reportObject(resultValue);
                    const status = typeof result.status === 'string' ? result.status : invalidReport();
                    if (!resultStatuses.has(status)) invalidReport();
                    if (result.error !== undefined) reportTestError(result.error);
                    if (result.errorLocation !== undefined) reportLocation(result.errorLocation);
                    return { status, errors: reportErrors(result.errors) };
                });
                if (test.status !== 'unexpected') continue;
                const terminal = results.at(-1) ?? invalidReport();
                if (!failureStatuses.has(terminal.status)) invalidReport();
                const browserClosed = terminal.errors.some(error =>
                    typeof error.message === 'string'
                    && /(?:Target page, context or browser has been closed|Target page has been closed|Target context has been closed|browser has been closed)/i.test(error.message));
                const classification = terminal.status === 'timedOut' ? 'timeout'
                    : terminal.status === 'interrupted' ? 'interrupted'
                        : browserClosed ? 'browser-closed'
                            : 'failure';
                failures.push({
                    project: publicProject(test.projectName),
                    file: publicSpecFile(spec.file),
                    line,
                    column,
                    classification,
                });
            }
        }
        const nestedSuites = suite.suites === undefined ? [] : reportArray(suite.suites);
        for (const nested of nestedSuites) visit(nested, depth + 1);
    };
    for (const suite of reportArray(report.suites)) visit(suite);
    if (failures.length !== unexpected) invalidReport();
    return {
        unexpected,
        rootErrors: rootErrors.length,
        failures,
    };
}

export async function assertPortsFree(tcp = [3410, 3411, 3412, 3413, 35432, 34880, 34881], udp = Array.from({ length: 21 }, (_, i) => 34900 + i)) {
    const closes: Array<() => Promise<void>> = [];
    try {
        for (const port of tcp) {
            const server = tcpServer();
            await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
            closes.push(() => new Promise(resolve => server.close(() => resolve())));
        }
        for (const port of udp) {
            const socket = createSocket('udp4');
            try { await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(port, '0.0.0.0', resolve); }); }
            catch (error) { socket.close(); throw error; }
            closes.push(() => new Promise(resolve => socket.close(resolve)));
        }
    } finally { await Promise.all(closes.map(close => close())); }
}

interface Probe { connect(): Promise<unknown>; query(sql: string): Promise<{ rows: Array<{ data_directory?: string }> }>; end(): Promise<unknown> }
export async function waitForPostgres(url: string, dataDirectory: string, owned: OwnedProcess, probe: () => Probe = () => new pg.Client({ connectionString: url, connectionTimeoutMillis: 1000, query_timeout: 1000 })) {
    const deadline = Date.now() + 30_000;
    for (;;) {
        if (!owned.alive()) throw new Error('Private Postgres exited before readiness');
        const db = probe(); let actual: string | undefined;
        try { await db.connect(); actual = (await db.query('show data_directory')).rows[0]?.data_directory; }
        catch { /* bounded retry while our process starts; never relax credentials */ }
        finally { await db.end(); }
        if (actual) {
            if (actual !== dataDirectory) throw new Error('Postgres ownership mismatch: data_directory is not the fresh cluster');
            if (!owned.alive()) throw new Error('Private Postgres exited during readiness');
            return;
        }
        if (Date.now() >= deadline) throw new Error('Private Postgres readiness timed out');
        await sleep(200);
    }
}

export async function startDockerBackend(dir: string, io: BackendIO, onCleanup: (close: () => Promise<void>) => void) {
    await io.run('docker', ['version']);
    const password = randomBytes(32).toString('hex');
    const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:35432/beacon_test`;
    assertSafeFixtureDatabaseUrl(databaseUrl);
    const container = async (name: string, args: string[]) => {
        const cidfile = path.join(dir, `${name}.cid`);
        onCleanup(async () => {
            const id = await readFile(cidfile, 'utf8').catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return ''; throw e; });
            if (id && !/^[a-f0-9]{64}$/.test(id.trim())) throw new Error('Invalid owned container ID');
            if (id) await (io.runCleanup ?? io.run)('docker', ['rm', '--force', id.trim()]);
        });
        await io.run('docker', ['run', '--detach', '--rm', '--cidfile', cidfile, '--name', `${path.basename(dir).toLowerCase()}-${name}`, ...args]);
    };
    await container('db', ['--tmpfs', '/var/lib/postgresql/data', '-p', '127.0.0.1:35432:5432', '-e', 'POSTGRES_DB=beacon_test', '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:16-alpine']);
    await io.waitPostgres(databaseUrl, '/var/lib/postgresql/data', { alive: () => true });
    const config = path.join(dir, 'livekit.yaml');
    await writeFile(config, 'port: 34880\nbind_addresses: ["0.0.0.0"]\nrtc:\n  tcp_port: 34881\n  port_range_start: 34900\n  port_range_end: 34920\n  use_external_ip: false\n  node_ip: 127.0.0.1\nkeys:\n  devkey: secret\n', { flag: 'wx', mode: 0o600 });
    await container('lk', ['-p', '127.0.0.1:34880:34880', '-p', '127.0.0.1:34881:34881', '-p', '127.0.0.1:34900-34920:34900-34920/udp', '-v', `${config}:/etc/livekit.yaml:ro`, 'livekit/livekit-server:v1.13.4', '--config', '/etc/livekit.yaml']);
    const versions = { images: await io.capture('docker', ['image', 'inspect', '--format', '{{.Id}} {{json .RepoDigests}}', 'postgres:16-alpine', 'livekit/livekit-server:v1.13.4']) };
    const livekit: OwnedProcess = { alive: () => true };
    return { databaseUrl, versions, livekit, restore: async (sql: string) => { void sql; await io.run(process.execPath, ['scripts/load-test-fixture.mjs']); } };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Linux-only detached groups: only descendants of commands we spawned are signalled. */
export function commandAdapter(cwd: string, env: NodeJS.ProcessEnv, logs: string, grace = 2000) {
    let serial = 0;
    const active = new Set<ReturnType<typeof start>>();
    function start(exe: string, args: string[], input?: string) {
        const logfile = path.join(logs, `${++serial}-${path.basename(exe)}.log`);
        const fd = openSync(logfile, 'wx', 0o600);
        const child = spawn(exe, args, { cwd, env, detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', fd, fd] });
        closeSync(fd);
        let error: Error | undefined;
        const done = new Promise<void>(resolve => { child.once('error', e => { error = e; resolve(); }); child.once('exit', () => resolve()); });
        // stdin EPIPE on a failed restore is reported by the command's exit status.
        child.stdin?.on('error', e => { error = e; });
        if (input !== undefined) child.stdin!.end(input);
        const owned = { child, done, logfile, alive: () => !error && child.exitCode === null && child.signalCode === null, error: () => error,
            async listening(port: number) {
                if (!child.pid || !owned.alive()) return false;
                // Fail closed if /proc is unavailable. Our direct foreground
                // server, not an unrelated HTTP 200, must own the listening inode.
                const tables = await Promise.all(['tcp', 'tcp6'].map(name => readFile(`/proc/net/${name}`, 'utf8')));
                const inodes = new Set(tables.flatMap(table => table.trim().split('\n').slice(1).map(row => row.trim().split(/\s+/)))
                    .filter(fields => fields[3] === '0A' && parseInt(fields[1].split(':')[1], 16) === port).map(fields => `socket:[${fields[9]}]`));
                const fds = await readdir(`/proc/${child.pid}/fd`).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
                const links = await Promise.all(fds.map(fd => readlink(`/proc/${child.pid}/fd/${fd}`).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return ''; throw e; })));
                return owned.alive() && links.some(link => inodes.has(link));
            } };
        active.add(owned); return owned;
    }
    async function stop(owned: ReturnType<typeof start>) {
        const pid = owned.child.pid;
        if (pid) {
            const signal = (s: NodeJS.Signals | 0) => { try { process.kill(-pid, s); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; return false; } };
            if (signal('SIGTERM')) {
                const until = Date.now() + grace;
                while (signal(0) && Date.now() < until) await sleep(25);
                if (signal(0)) signal('SIGKILL');
                // Exit of direct child is bounded; unreaped adopted zombies are
                // PID1's responsibility, not a reason to signal unrelated PIDs.
                await Promise.race([owned.done, sleep(grace)]);
            }
        }
        active.delete(owned);
    }
    async function execute(exe: string, args: string[], input?: string, timeout = 600_000) {
        const owned = start(exe, args, input);
        let timer: NodeJS.Timeout | undefined;
        try {
            await Promise.race([owned.done, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${exe} timed out; log: ${owned.logfile}`)), timeout); })]);
            if (owned.error()) throw owned.error();
            if (owned.child.exitCode !== 0) throw new Error(`${exe} exited ${owned.child.exitCode ?? owned.child.signalCode}; log: ${owned.logfile}`);
            return owned.logfile;
        } finally { clearTimeout(timer); await stop(owned); }
    }
    return {
        start,
        run: async (exe: string, args: string[], input?: string, timeout?: number) => { await execute(exe, args, input, timeout ?? 600_000); },
        capture: async (exe: string, args: string[]) => readFile(await execute(exe, args, undefined, 30_000), 'utf8'),
        stopAll: async () => { await Promise.all([...active].map(stop)); },
    };
}

/** closeAllConnections excludes upgraded sockets; retain both proxy ends explicitly. */
export function trackConnections(server: Server) {
    const sockets = new Set<Socket>();
    const track = (socket: Socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); return socket; };
    server.on('connection', track);
    return { track, close: () => new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Fixture server close timed out')), 3000);
        server.close(() => { clearTimeout(timer); resolve(); });
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
    }) };
}

export interface OwnedProcess { alive(): boolean; listening?(port: number): Promise<boolean> }
export interface BackendIO {
    run(exe: string, args: string[], input?: string): Promise<void>;
    capture(exe: string, args: string[]): Promise<string>;
    runCleanup?(exe: string, args: string[]): Promise<void>;
    start(exe: string, args: string[]): OwnedProcess;
    waitPostgres(url: string, dataDirectory: string, process: OwnedProcess): Promise<void>;
}

export async function startNativeBackend(options: { dir: string; uid: number; pgBin: string; livekitBin: string }, io: BackendIO) {
    if (options.uid === 0) throw new Error('Native PostgreSQL requires an unprivileged test user; run the entire job and its private Pulse server as that user (no root fallback).');
    if (![options.pgBin, options.livekitBin].every(p => path.isAbsolute(p))) throw new Error('Native binary paths must be absolute');
    const versions: Record<string, string> = {};
    for (const name of ['initdb', 'postgres', 'pg_ctl', 'psql']) {
        const exe = path.join(options.pgBin, name);
        versions[exe] = (await io.capture(exe, ['--version'])).trim();
        if (!/\(PostgreSQL\) 16\.15(?:\s|$)/.test(versions[exe])) throw new Error(`Expected PostgreSQL version 16.15 at ${exe}; got ${versions[exe]}`);
    }
    versions[options.livekitBin] = (await io.capture(options.livekitBin, ['--version'])).trim();
    if (!/\bversion 1\.13\.4(?:\s|$)/.test(versions[options.livekitBin])) throw new Error(`Expected LiveKit version 1.13.4; got ${versions[options.livekitBin]}`);
    const data = path.join(options.dir, 'pgdata'); const sockets = path.join(options.dir, 'pgsocket');
    // Exclusive mkdir: no adopting a pre-existing cluster, even in our job dir.
    await mkdir(data, { mode: 0o700 }); await mkdir(sockets, { mode: 0o700 });
    const password = randomBytes(32).toString('hex');
    const pwfile = path.join(options.dir, 'postgres-password');
    await writeFile(pwfile, `${password}\n`, { mode: 0o600, flag: 'wx' });
    const adminUrl = `postgresql://postgres:${password}@127.0.0.1:35432/postgres`;
    const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:35432/beacon_test`;
    assertSafeFixtureDatabaseUrl(databaseUrl);
    await io.run(path.join(options.pgBin, 'initdb'), ['-D', data, '-U', 'postgres', '--encoding=UTF8', '--no-locale', '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', `--pwfile=${pwfile}`]);
    const postgres = io.start(path.join(options.pgBin, 'postgres'), ['-D', data, '-p', '35432', '-c', 'listen_addresses=127.0.0.1', '-c', `unix_socket_directories=${sockets}`]);
    // Authenticate with unpredictable job-only credentials AND prove data_directory
    // before any mutation. Failure/bind collision must never fall back to a DB URL.
    await io.waitPostgres(adminUrl, data, postgres);
    await io.run(path.join(options.pgBin, 'psql'), ['-X', adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE beacon_test']);
    const config = path.join(options.dir, 'livekit.yaml');
    // Signal plane stays loopback. Native ICE discovers the real container NIC;
    // advertising 127.0.0.1 breaks Firefox RTC. Never use Docker's override here.
    await writeFile(config, 'port: 34880\nbind_addresses: ["127.0.0.1"]\nrtc:\n  tcp_port: 34881\n  port_range_start: 34900\n  port_range_end: 34920\n  use_external_ip: false\nkeys:\n  devkey: secret\n', { flag: 'wx', mode: 0o600 });
    const livekit = io.start(options.livekitBin, ['--config', config]);
    let restored = false;
    return { databaseUrl, versions, postgres, livekit, async restore(sql: string) {
        assertSafeFixtureDatabaseUrl(databaseUrl);
        if (restored || !postgres.alive()) throw new Error('Restore requires our fresh running cluster and is single-use');
        restored = true;
        await io.run(path.join(options.pgBin, 'psql'), ['-X', databaseUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-o', '/dev/null'], `${sql}\nUPDATE public.ticket_entitlements SET expires_at = GREATEST(expires_at, CURRENT_TIMESTAMP + INTERVAL '24 hours') WHERE state <> 'REVOKED' AND revoked_at IS NULL;\n`);
    } };
}

export async function runtimeEnv(source: Record<string, string | undefined>, dir: string): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { PATH: source.PATH, HOME: source.HOME, TMPDIR: dir, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=2048', NEXT_TELEMETRY_DISABLED: '1' };
    if (source.CI) env.CI = '1';
    if (source.NEXT_PUBLIC_E2E_CONTINUITY_OBSERVER === '1') env.NEXT_PUBLIC_E2E_CONTINUITY_OBSERVER = '1';
    for (const name of ['PLAYWRIGHT_CHROME_EXECUTABLE', 'PLAYWRIGHT_BROWSERS_PATH']) {
        if (source[name]) {
            if (!path.isAbsolute(source[name]!)) throw new Error(`${name} must be an absolute installed path`);
            env[name] = await realpath(source[name]!);
        }
    }
    if (source.PULSE_SERVER) {
        const privateDir = source.E2E_ACCOUNT_PULSE_DIR;
        const socket = source.PULSE_SERVER.slice(5);
        try {
            if (!source.PULSE_SERVER.startsWith('unix:') || !privateDir || !path.isAbsolute(privateDir) || !path.isAbsolute(socket) || /\s/.test(socket) || path.dirname(socket) !== privateDir) throw new Error('not job-private Unix');
            const [d, s] = await Promise.all([lstat(privateDir), lstat(socket)]);
            if (await realpath(privateDir) !== privateDir || await realpath(socket) !== socket || !d.isDirectory() || (d.mode & 0o077) !== 0 || !s.isSocket() || d.uid !== process.getuid?.() || s.uid !== d.uid) throw new Error('wrong owner, permissions or type');
            env.PULSE_SERVER = source.PULSE_SERVER;
        } catch (error) { throw new Error(`Pulse requires a same-user socket directly inside E2E_ACCOUNT_PULSE_DIR (0700, no symlinks): ${error}`); }
    }
    return env;
}

export async function copySource(root: string, checkout: string) {
    const sourceRoots = new Set(['src', 'public', 'prisma', 'scripts', 'db', 'e2e', 'package.json', 'package-lock.json', 'next.config.ts', 'playwright.config.ts', 'tsconfig.json', 'next-env.d.ts', 'postcss.config.mjs', 'prisma.config.ts', 'middleware.ts', 'eslint.config.mjs']);
    await cp(root, checkout, { recursive: true, filter: async source => {
        const parts = path.relative(root, source).split(path.sep);
        return (!parts[0] || sourceRoots.has(parts[0])) && !parts.some(part => part.startsWith('.env') || ['node_modules', '.git', '.next', 'test-results', 'playwright-report'].includes(part)) && !(await lstat(source)).isSymbolicLink();
    } });
}
