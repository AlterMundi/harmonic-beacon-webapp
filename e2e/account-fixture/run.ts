/** Disposable Account qualification stack; Docker (default) or explicit native.
 * Run the native job as an unprivileged test user. See README for private audio. */
import { mkdtemp, readFile, writeFile, symlink, mkdir, realpath, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { connect } from 'node:net';
import pg from 'pg';
import { startAccountFixture, FIXTURE_CLIENT_ID, FIXTURE_CLIENT_SECRET } from './protocol';
import { runtimeEnv, copySource, commandAdapter, assertPortsFree, waitForPostgres, startNativeBackend, startDockerBackend, trackConnections, summarizePlaywrightFailureReport } from './runtime-backend';

async function main() {
    const root = process.cwd();
    const backend = process.env.E2E_ACCOUNT_BACKEND ?? 'docker';
    if (!['docker', 'native'].includes(backend)) throw new Error('E2E_ACCOUNT_BACKEND must be docker or native');
    if (process.platform !== 'linux') throw new Error('The isolated runner requires Linux process groups');
    if (backend === 'native' && process.getuid!() === 0) throw new Error('Native PostgreSQL requires an unprivileged test user; run the entire job and same-user private Pulse server as that user.');
    const dir = await mkdtemp(path.join(tmpdir(), 'navigation-account-'));
    console.log(`Account runtime evidence (partial until gates finish): ${dir}`);
    const checkout = path.join(dir, 'app');
    const env = await runtimeEnv(process.env, dir);
    const logs = path.join(dir, 'logs'); await mkdir(logs);
    await copySource(root, checkout);
    await symlink(path.join(root, 'node_modules'), path.join(checkout, 'node_modules'), 'dir');
    const io = commandAdapter(checkout, env, logs);
    let interruptedJob = false;
    const active = () => { if (interruptedJob) throw new Error('Account job interrupted'); };
    const guardedIO = {
        ...io,
        runCleanup: io.run,
        run: async (...args: Parameters<typeof io.run>) => { active(); await io.run(...args); },
        capture: async (...args: Parameters<typeof io.capture>) => { active(); return io.capture(...args); },
        start: (...args: Parameters<typeof io.start>) => { active(); return io.start(...args); },
    };
    const command = guardedIO.run;
    const closes: Array<() => Promise<void>> = [];
    const containerCloses: Array<() => Promise<void>> = [];
    const evidence: Record<string, unknown> = { backend, root, checkout, node: process.version, state: 'setup', argv: process.argv.slice(2), heap: env.NODE_OPTIONS, ci: !!env.CI, pulse: env.PULSE_SERVER ?? null,
        browserPaths: { chromiumOverride: env.PLAYWRIGHT_CHROME_EXECUTABLE ?? null, cacheOverride: env.PLAYWRIGHT_BROWSERS_PATH ?? null } };
    const save = () => writeFile(path.join(dir, 'runtime.json'), JSON.stringify(evidence, null, 2));
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () => cleanupPromise ??= (async () => {
        const errors: string[] = [];
        const attempt = async (close: () => Promise<void>) => {
            let timer: NodeJS.Timeout | undefined;
            try { await Promise.race([close(), new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error('cleanup deadline exceeded')), 15_000); })]); }
            catch (error) { errors.push(String(error)); }
            finally { clearTimeout(timer); }
        };
        await attempt(io.stopAll);
        for (const close of containerCloses.reverse()) await attempt(close);
        for (const close of closes.reverse()) await attempt(close);
        // Also reap any cleanup CLI still running after its bounded deadline.
        await attempt(io.stopAll);
        evidence.cleanup = errors.length ? { errors } : 'completed'; await save();
        console.log(`Retained private checkout, logs, test-only secrets/certificates and available artifacts: ${dir}`);
        console.log(backend === 'native' ? 'Stopped private PG data retained (NOT a portable DB snapshot).' : 'Docker tmpfs DB discarded; no database snapshot retained.');
        if (errors.length) throw new Error(`Incomplete cleanup: ${errors.join('; ')}`);
    })();
    const interrupted = () => { interruptedJob = true; evidence.state = 'interrupted'; void cleanup().then(() => process.exit(130), error => { console.error(error); process.exit(130); }); };
    process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
    try {
        await save();
        await assertPortsFree();
        const sourceHashes: Record<string, string> = {};
        async function hashInputs(relative = '') {
            for (const entry of await readdir(path.join(checkout, relative), { withFileTypes: true })) {
                const name = path.join(relative, entry.name);
                if (entry.isDirectory()) await hashInputs(name);
                else if (entry.isFile()) sourceHashes[name] = createHash('sha256').update(await readFile(path.join(checkout, name))).digest('hex');
            }
        }
        await hashInputs(); await writeFile(path.join(dir, 'source-sha256.json'), JSON.stringify(sourceHashes, null, 2));
        const declared = JSON.parse(await readFile(path.join(checkout, 'package.json'), 'utf8'));
        const installed = JSON.parse(await readFile(path.join(checkout, 'node_modules/next/package.json'), 'utf8'));
        if (installed.version !== declared.dependencies.next) throw new Error('Installed Next differs from pinned source version');
        const help = await io.capture(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--help']);
        if (!help.includes('--webpack')) throw new Error('Pinned Next CLI does not support --webpack');
        evidence.next = installed.version;
        evidence.playwright = (await io.capture(process.execPath, ['node_modules/@playwright/test/cli.js', '--version'])).trim();
        await save();
        const cert = path.join(dir, 'localhost.crt'); const key = path.join(dir, 'localhost.key');
        await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
        const tls = { key: await readFile(key), cert: await readFile(cert) };
        active();
        const liveOrigin = 'https://127.0.0.1:3410';
        const account = await startAccountFixture({ port: 3411, liveOrigin, tls }); closes.push(account.close);
        const nativeOptions = backend === 'native' ? { dir, uid: process.getuid!(), pgBin: await realpath(process.env.E2E_ACCOUNT_PG_BIN ?? '/usr/lib/postgresql/16/bin'), livekitBin: await realpath(process.env.E2E_ACCOUNT_LIVEKIT_BIN ?? '/usr/local/bin/livekit-server') } : undefined;
        const stack = nativeOptions
            ? await startNativeBackend(nativeOptions, { ...guardedIO, waitPostgres: waitForPostgres })
            : await startDockerBackend(dir, { ...guardedIO, waitPostgres: waitForPostgres }, close => containerCloses.push(close));
        evidence.backendVersions = stack.versions;
        if (nativeOptions) {
            const binaries: Record<string, string> = {};
            for (const file of Object.keys(stack.versions)) binaries[await realpath(file)] = createHash('sha256').update(await readFile(file)).digest('hex');
            evidence.binarySha256 = binaries;
        }
        await save();
        const databaseUrl = stack.databaseUrl;
        const suffix = path.basename(dir).toLowerCase();
        Object.assign(env, { DATABASE_URL: databaseUrl, E2E_DATABASE_URL: databaseUrl, TICKET_CODE_PEPPER: 'test-fixture-pepper-not-for-production' });
        await stack.restore(await readFile(path.join(checkout, 'db/test-fixture.sql'), 'utf8'));
        await command(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
        const db = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, query_timeout: 10_000 });
        try {
            await db.connect();
            await db.query('begin');
            await db.query('create table navigation_account_fixture (instance text not null, issuer text not null)');
            await db.query('insert into navigation_account_fixture values ($1, $2)', [suffix, account.issuer]);
            for (const [subject, email] of [['fixture-operator', 'operator1@altermundi.net'], ['fixture-facilitator', 'facilitator@altermundi.net'], ['fixture-admin', 'admin@altermundi.net']]) {
                const result = await db.query('insert into staff_account_bindings (id, account_issuer, account_subject, staff_user_id) select gen_random_uuid(), $1, $2, id from users where email = $3 returning id', [account.issuer, subject, email]);
                if (result.rowCount !== 1) throw new Error('Missing seeded staff authority');
            }
            const event = await db.query("update scheduled_sessions set public_access = true where id = '10000000-0000-4000-8000-000000000101' and is_test = true returning id");
            if (event.rowCount !== 1) throw new Error('Missing isolated test session');
            await db.query('commit');
        } finally { await db.end(); }
        // TLS proxies preserve Host and all cookie/Origin behavior. Node trusts
        // just the generated fixture certificate; TLS verification stays on.
        async function proxy(port: number, upstream: number) {
            active();
            const server = createServer(tls, (req, res) => {
                const outgoing = request({ host: '127.0.0.1', port: upstream, method: req.method, path: req.url, headers: req.headers }, response => { res.writeHead(response.statusCode!, response.headers); response.pipe(res); });
                outgoing.on('socket', socket => tracked.track(socket));
                outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
                res.on('close', () => outgoing.destroy()); req.pipe(outgoing);
            });
            const tracked = trackConnections(server);
            closes.push(tracked.close);
            server.on('upgrade', (req, socket, head) => {
                const target = tracked.track(connect(upstream, '127.0.0.1', () => {
                    target.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
                    if (head.length) target.write(head); socket.pipe(target).pipe(socket);
                }));
                target.on('error', () => socket.destroy()); socket.on('error', () => target.destroy());
                target.on('close', () => socket.destroy()); socket.on('close', () => target.destroy());
            });
            await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
        }
        await proxy(3410, 3413); await proxy(3412, 34880);
        const results = path.join(dir, 'results'); await mkdir(results);
        Object.assign(env, { BEACON_ACCOUNT_ENABLED: 'true', BEACON_ACCOUNT_ISSUER_URL: account.issuer, BEACON_ACCOUNT_CLIENT_ID: FIXTURE_CLIENT_ID, BEACON_ACCOUNT_CLIENT_SECRET: FIXTURE_CLIENT_SECRET,
            NODE_EXTRA_CA_CERTS: cert, TICKET_LOGIN_URL_PREFIX: `${liveOrigin}/`, E2E_ACCOUNT_FIXTURE: '1', E2E_ACCOUNT_INSTANCE: suffix, E2E_ACCOUNT_ISSUER: account.issuer, E2E_BASE_URL: liveOrigin, E2E_ACCOUNT_RESULTS: results,
            E2E_DASHBOARD_ENABLED: '1', E2E_CLOCK_NOW: '2026-08-21T12:00:00.000Z', PROMO_INVITATIONS_ENABLED: 'true', SESSION_COOKIE_TTL_SECONDS: '604800',
            LIVEKIT_PUBLIC_URL: 'wss://127.0.0.1:3412', LIVEKIT_PUBLIC_URL_ALLOWLIST: 'wss://127.0.0.1:3412', LIVEKIT_INTERNAL_URL: 'http://127.0.0.1:34880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret', LIVEKIT_ROOM_NAME: 'beacon',
            E2E_LIVEKIT_URL: 'wss://127.0.0.1:3412', E2E_LIVEKIT_API_KEY: 'devkey', E2E_LIVEKIT_API_SECRET: 'secret' });
        evidence.state = 'building'; await save();
        await command(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack']);
        const app = guardedIO.start(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3413']);
        const readyBy = Date.now() + 60_000;
        for (;;) {
            if (interruptedJob || !app.alive() || !stack.livekit.alive()) throw new Error('Private app/LiveKit exited or job interrupted');
            try {
                if (!await app.listening(3413) || (nativeOptions && !await stack.livekit.listening?.(34880))) throw new Error('Private listeners not yet owned');
                const [response, lk] = await Promise.all([fetch('http://127.0.0.1:3413/', { signal: AbortSignal.timeout(1000) }), fetch('http://127.0.0.1:34880/', { signal: AbortSignal.timeout(1000) })]);
                const ready = response.ok && lk.ok;
                await Promise.all([response.body?.cancel(), lk.body?.cancel()]);
                if (ready && app.alive() && stack.livekit.alive()) break;
            } catch { /* bounded readiness */ }
            if (Date.now() > readyBy) throw new Error('Private Live/LiveKit server not ready');
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        evidence.state = 'browser-tests'; await save();
        console.log(`Isolated external identity simulation ready. Logs and engine-labelled results: ${dir}`);
        try {
            await command(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'e2e/account-fixture/playwright.config.ts', ...process.argv.slice(2)], undefined, 60 * 60_000);
        } catch (error) {
            try {
                const report = JSON.parse(await readFile(path.join(results, 'report.json'), 'utf8'));
                const summary = summarizePlaywrightFailureReport(report);
                evidence.publicFailureSummary = summary;
                await save();
                console.error(`ACCOUNT_PLAYWRIGHT_FAILURE_SUMMARY ${JSON.stringify(summary)}`);
            } catch {
                console.error('ACCOUNT_PLAYWRIGHT_FAILURE_SUMMARY unavailable');
            }
            throw error;
        }
        evidence.state = process.argv.includes('--list') ? 'listed-only-not-qualified' : 'selected-browser-command-passed';
    } catch (error) {
        if (!interruptedJob) { evidence.state = 'failed'; evidence.error = String(error); }
        throw error;
    } finally {
        await cleanup();
        process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
