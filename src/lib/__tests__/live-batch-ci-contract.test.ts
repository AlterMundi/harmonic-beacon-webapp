import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Step = { name?: string; run?: string; if?: string; uses?: string; with?: Record<string, unknown> };
type Job = { steps: Step[]; env?: Record<string, string>; services?: unknown; if?: string; 'runs-on'?: string };
const workflow = () => parse(readFileSync('.github/workflows/e2e.yml', 'utf8')) as { jobs: Record<string, Job> };
const helperConfig = 'e2e/helpers/playwright.config.ts';

function assertHelperBrowserInstallOrder(steps: Step[]) {
    const chromiumInstall = steps.find((entry) => entry.name === 'Install Chromium browser');
    const chromium = steps.find((entry) => entry.name === 'Run isolated Chromium room-exit helper regressions');
    const firefoxInstall = steps.find((entry) => entry.name === 'Install Firefox after Chromium screenshot gates');
    const firefoxHelper = steps.find((entry) => entry.name === 'Run isolated Firefox room-exit helper regression');
    expect(chromiumInstall?.run).toBe('npx playwright install --with-deps chromium');
    expect(chromium?.run).toContain("--test-name-pattern='^chromium two identified native RTC sources:'");
    expect(chromium?.run).toContain('playwright test');
    expect(chromium?.run).toContain('--retries=0 --workers=1');
    expect(chromium?.run).not.toMatch(/--list|--grep/);
    expect(chromium?.if).toBeUndefined();
    expect(firefoxInstall?.run).toBe('npx playwright install --with-deps firefox');
    expect(firefoxHelper?.run).toContain("--test-name-pattern='^Firefox automation reload'");
    expect(firefoxHelper?.run).not.toMatch(/--list|--grep/);
    expect(firefoxHelper?.if).toBeUndefined();
    expect(steps.indexOf(chromiumInstall!)).toBeLessThan(steps.indexOf(chromium!));
    expect(steps.indexOf(chromium!)).toBeLessThan(steps.indexOf(firefoxInstall!));
    expect(steps.indexOf(firefoxInstall!)).toBeLessThan(steps.indexOf(firefoxHelper!));
}

// Execute the workflow shell, then simulate GitHub's next-step environment.
// Python AF_UNIX rejects overlong byte paths instead of Node silently truncating them.
const socketProbe = `
import os, socket, tempfile, json
root = os.environ['TMPDIR']
runtime = tempfile.mkdtemp(prefix='navigation-account-', dir=root)
node = tempfile.mkdtemp(prefix='account-pulse-test-', dir=root)
browser = tempfile.mkdtemp(prefix='playwright_chromiumdev_profile-', dir=runtime)
paths = [node + '/audio.sock', runtime + '/pgsocket/.s.PGSQL.35432',
         browser + '/SingletonSocket', root + '/pulse/native']
for p in paths:
    os.makedirs(os.path.dirname(p), mode=0o700, exist_ok=True)
    with socket.socket(socket.AF_UNIX) as server:
        server.bind(p)
        server.listen(1)
        with socket.socket(socket.AF_UNIX) as client:
            client.connect(p)
            peer, _ = server.accept()
            peer.close()
    os.unlink(p)
print(json.dumps([{'path': p, 'bytes': len(os.fsencode(p))} for p in paths]))
`;

// Only external Pulse/Docker entrypoints are substituted. Allocation, auth argv,
// readiness, environment propagation, failure status and EXIT trap are real YAML.
const audioDouble = `#!/usr/bin/env python3
import os, sys, socket, json, signal
from pathlib import Path
name = Path(sys.argv[0]).name
if name == 'pulseaudio':
    native = next(a for a in sys.argv if a.startswith('--load=module-native-protocol-unix '))
    assert native.endswith(' auth-anonymous=0')
    p = native.split('socket=', 1)[1].split(' ', 1)[0]
    assert os.path.realpath(os.path.dirname(p)) == os.path.dirname(p)
    assert os.stat(os.path.dirname(p)).st_uid == os.getuid()
    assert os.stat(os.path.dirname(p)).st_mode & 0o777 == 0o700
    log = next(a.split('file:', 1)[1] for a in sys.argv if a.startswith('--log-target='))
    Path(log).write_text('private fixture Pulse evidence')
    Path(os.environ['PROBE_PID']).write_text(str(os.getpid()))
    signal.alarm(10)
    with socket.socket(socket.AF_UNIX) as server:
        server.bind(p)
        server.listen(1)
        while True:
            peer, _ = server.accept()
            peer.close()
elif name == 'pactl':
    with socket.socket(socket.AF_UNIX) as client:
        client.connect(os.environ['PULSE_SERVER'].removeprefix('unix:'))
else:
    assert os.environ['E2E_ACCOUNT_BACKEND'] == 'docker'
    assert os.environ['PULSE_SERVER'] == 'unix:' + os.environ['E2E_ACCOUNT_PULSE_DIR'] + '/native'
    assert os.environ['TMPDIR'] == os.environ['BEACON_CI_ROOT']
    root = Path(os.environ['TMPDIR'])
    (root / 'runtime.json').write_text(json.dumps({'fixture': True, 'exit': os.environ['PROBE_EXIT']}))
    sys.exit(int(os.environ['PROBE_EXIT']))
`;

for (const jobName of ['account', 'e2e']) {
    describe(`${jobName} executable socket-root allocation`, () => {
        for (const input of ['normal', 'long', 'unicode']) {
            it(`binds real sockets beneath nested runtime TMPDIR with ${input} RUNNER_TEMP`, () => {
                const fixture = mkdtempSync('/tmp/bci-test-');
                const runnerTemp = path.join(fixture, input === 'normal' ? 'runner' : (input === 'long' ? 'runner-'.repeat(20) : '界'.repeat(50)));
                mkdirSync(runnerTemp, { mode: 0o700 });
                const githubEnv = path.join(fixture, 'env');
                writeFileSync(githubEnv, '');
                const job = workflow().jobs[jobName];
                const env: NodeJS.ProcessEnv = { ...process.env, RUNNER_TEMP: runnerTemp, TMPDIR: fixture, GITHUB_ENV: githubEnv };
                delete env.BEACON_CI_ROOT; // Never adopt or clean up the outer CI job's root.
                // Honor the old job env too: the RED must exercise its actual long TMPDIR.
                for (const [key, value] of Object.entries(job.env ?? {})) env[key] = value.replace('${{ runner.temp }}', runnerTemp);
                let allocated: string | undefined;
                try {
                    const prepare = job.steps.find(step => step.name?.startsWith('Prepare private'));
                    expect(prepare?.run, 'allocate before any Node/browser consumer').toBeDefined();
                    execFileSync('bash', ['-euo', 'pipefail', '-c', prepare!.run!], { env, timeout: 5000 });
                    for (const line of readFileSync(githubEnv, 'utf8').trim().split('\n').filter(Boolean)) {
                        const split = line.indexOf('=');
                        env[line.slice(0, split)] = line.slice(split + 1);
                    }
                    allocated = env.BEACON_CI_ROOT;
                    const lengths = JSON.parse(execFileSync('python3', ['-c', socketProbe], { env, encoding: 'utf8', timeout: 5000 }));
                    expect(allocated).toBeDefined();
                    expect(env.TMPDIR).toBe(allocated);
                    expect(realpathSync(allocated!)).toBe(allocated);
                    expect(statSync(allocated!).uid).toBe(process.getuid!());
                    expect(statSync(allocated!).mode & 0o777).toBe(0o700);
                    expect(env.XDG_RUNTIME_DIR).toBe(path.join(allocated!, 'xdg'));
                    expect(statSync(env.XDG_RUNTIME_DIR!).mode & 0o777).toBe(0o700);
                    expect(lengths.every((entry: { bytes: number }) => entry.bytes <= 107)).toBe(true);
                    expect(job.steps.indexOf(prepare!)).toBeLessThan(job.steps.findIndex(step => step.run?.includes('npm ci')));
                    if (jobName === 'account') {
                        const bin = path.join(fixture, 'bin'); mkdirSync(bin);
                        for (const command of ['pulseaudio', 'pactl', 'node']) writeFileSync(path.join(bin, command), audioDouble, { mode: 0o700 });
                        const gate = job.steps.find(step => step.run?.includes('node --import tsx e2e/account-fixture/run.ts'))!;
                        for (const status of [0, 23]) {
                            const pidfile = path.join(fixture, 'pulse.pid');
                            const result = spawnSync('bash', ['-euo', 'pipefail', '-c', gate.run!], {
                                env: { ...env, PATH: `${bin}:${process.env.PATH}`, PROBE_PID: pidfile, PROBE_EXIT: String(status) },
                                encoding: 'utf8', timeout: 8000,
                            });
                            expect(result.status, result.stderr).toBe(status);
                            const pid = Number(readFileSync(pidfile, 'utf8'));
                            expect(() => process.kill(pid, 0), 'EXIT trap must reap its own Pulse on success AND failure').toThrow();
                            expect(JSON.parse(readFileSync(path.join(allocated!, 'runtime.json'), 'utf8')).exit).toBe(String(status));
                        }
                    } else {
                        // Exercise the main job's actual Pulse path too, without installing
                        // packages or starting a persistent daemon. This is a socket-path
                        // contract, not Pulse protocol/readiness qualification.
                        const bin = path.join(fixture, 'bin'); mkdirSync(bin);
                        writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
                        writeFileSync(path.join(bin, 'pulseaudio'), `#!/usr/bin/env python3
import socket, sys
native = next(a for a in sys.argv if a.startswith('--load=module-native-protocol-unix '))
assert native.endswith(' auth-anonymous=0')
p = native.split('socket=', 1)[1].split(' ', 1)[0]
with socket.socket(socket.AF_UNIX) as server:
    server.bind(p)
`, { mode: 0o700 });
                        writeFileSync(path.join(bin, 'pactl'), `#!/usr/bin/env python3
import os, stat
assert stat.S_ISSOCK(os.stat(os.environ['PULSE_SERVER'].removeprefix('unix:')).st_mode)
`, { mode: 0o700 });
                        const audio = job.steps.find(step => step.name === 'Start isolated browser audio backend')!;
                        execFileSync('bash', ['-euo', 'pipefail', '-c', audio.run!], { env: { ...env, PATH: `${bin}:${process.env.PATH}` }, timeout: 5000 });
                        const exported = readFileSync(githubEnv, 'utf8').split('\n').find(line => line.startsWith('PULSE_SERVER='));
                        expect(exported).toBe(`PULSE_SERVER=unix:${allocated}/native`);
                    }
                } finally {
                    const pidfile = path.join(fixture, 'pulse.pid');
                    if (existsSync(pidfile)) {
                        const pid = Number(readFileSync(pidfile, 'utf8'));
                        const cmdline = `/proc/${pid}/cmdline`;
                        // Exceptional timeout/assertion path: never signal a PID unless
                        // it is still our exact fixture executable (not a reused PID).
                        try {
                            if (readFileSync(cmdline, 'utf8').split('\0').includes(path.join(fixture, 'bin', 'pulseaudio'))) process.kill(pid, 'SIGKILL');
                        } catch (error) {
                            if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
                        }
                    }
                    // Only the fresh root allocated by this invocation, never arbitrary inherited TMPDIR.
                    if (allocated && /^\/tmp\/bci\.[A-Za-z0-9]{6}$/.test(allocated) && statSync(allocated).uid === process.getuid!()) rmSync(allocated, { recursive: true });
                    rmSync(fixture, { recursive: true, force: true });
                }
            });
        }
    });
}

describe('Isolated Account CI gate', () => {
    it('runs the Node protocol/runtime contracts explicitly before the real isolated four-project runner', () => {
        const job = workflow().jobs.account;
        expect(job, 'Account must have its own Docker-capable job').toBeDefined();
        expect(job['runs-on']).toBe('ubuntu-latest');
        expect(job.services).toBeUndefined(); // runner creates and verifies its own PG/LiveKit
        const commands = job.steps.map((step) => step.run ?? '').join('\n');
        expect(commands).toContain('node --import tsx --test e2e/account-fixture/protocol.test.ts e2e/account-fixture/runtime-backend.test.ts');
        expect(commands).toContain('playwright install --with-deps chromium firefox webkit');
        const gate = job.steps.find((step) => step.run?.includes('node --import tsx e2e/account-fixture/run.ts'));
        expect(gate?.if).toBeUndefined();
        expect(gate?.run).toContain('E2E_ACCOUNT_BACKEND=docker');
        for (const project of ['chromium-account', 'android-chrome-account', 'firefox-account', 'iphone-webkit-account']) {
            expect(gate?.run).toContain(`--project=${project}`);
        }
        expect(gate?.run).toContain('--retries=0 --workers=1');
        expect(gate?.run).not.toMatch(/--list|--grep|continue-on-error|\|\| true/);
        expect(commands.indexOf('node --import tsx --test')).toBeLessThan(commands.indexOf('node --import tsx e2e/account-fixture/run.ts'));
    });

    it('creates same-UID private authenticated Pulse and retains sensitive receipts only as short-lived private artifacts', () => {
        const job = workflow().jobs.account;
        expect(job).toBeDefined();
        const gate = job.steps.find((step) => step.run?.includes('node --import tsx e2e/account-fixture/run.ts'));
        expect(gate?.run).toContain('umask 077');
        expect(gate?.run).toContain('mktemp -d');
        expect(gate?.run).toContain('chmod 700 "$audio"');
        expect(gate?.run).toContain('E2E_ACCOUNT_PULSE_DIR="$audio"');
        expect(gate?.run).toContain('PULSE_SERVER="unix:$audio/native"');
        expect(gate?.run).toContain('auth-anonymous=0');
        expect(gate?.run).toContain('pactl info');
        expect(gate?.run).toContain('trap');
        expect(gate?.run).not.toMatch(/sudo pulseaudio|auth-anonymous=1/);
        const artifact = job.steps.find((step) => step.uses === 'actions/upload-artifact@v4');
        expect(artifact?.if).toBe('always() && github.event.repository.private == true');
        expect(artifact?.with?.['retention-days']).toBe(3);
        expect(String(artifact?.with?.path).trim().split('\n')).toEqual([
            '${{ env.BEACON_CI_ROOT }}/**/runtime.json',
            '${{ env.BEACON_CI_ROOT }}/**/source-sha256.json',
            '${{ env.BEACON_CI_ROOT }}/**/logs/**',
            '${{ env.BEACON_CI_ROOT }}/**/results/**',
            '${{ env.BEACON_CI_ROOT }}/pulse-*/pulse.log',
        ]);
        expect(job.env?.TMPDIR).toBeUndefined();
    });
});

describe('Main browser CI execution policy', () => {
    it('executes discovery contracts and prevents retry masking in every acceptance command', () => {
        const job = workflow().jobs.e2e;
        const steps = job.steps;
        expect(job.env?.NEXT_PUBLIC_E2E_CONTINUITY_OBSERVER).toBe('1');
        expect(workflow().jobs.account.env?.NEXT_PUBLIC_E2E_CONTINUITY_OBSERVER).toBe('1');
        const contracts = steps.find((step) => step.run?.includes('src/lib/__tests__/live-batch-ci-contract.test.ts'));
        expect(contracts?.run).toContain('src/lib/__tests__/live-batch-browser-contract.test.ts');
        expect(contracts?.if).toBeUndefined();
        for (const step of steps.filter((entry) => entry.run?.includes('playwright test'))) {
            expect(step.run, step.name).toContain('--retries=0 --workers=1');
            expect(step.run, step.name).not.toMatch(/--list|--grep/);
        }
        const artifacts = steps.find((step) => step.with?.name === 'playwright-report');
        expect(artifacts?.if).toBe('always() && github.event.repository.private == true');
        expect(artifacts?.with?.['retention-days']).toBe(3);
        expect(artifacts?.with?.path).toContain('test-results/helpers/');
    });
});

describe('Live batch executable CI discovery', () => {
    it('collects all sixteen isolated helper browser regressions, outside the main testDir', () => {
        expect(existsSync(helperConfig), 'dedicated helper discovery config is missing').toBe(true);
        const report = JSON.parse(execFileSync(process.execPath, [
            'node_modules/@playwright/test/cli.js', 'test', '--config', helperConfig, '--list', '--reporter=json',
        ], { encoding: 'utf8', env: { ...process.env, CI: '1' } }));
        const titles: string[] = [];
        type Suite = { specs: { title: string }[]; suites?: Suite[] };
        const visit = (suites: Suite[]) => {
            for (const suite of suites) {
                titles.push(...suite.specs.map((spec) => spec.title));
                visit(suite.suites ?? []);
            }
        };
        visit(report.suites);
        expect(titles).toHaveLength(16);
        expect(titles).toContain('rejects a delayed second owner; disconnect=true');
        expect(report.config.projects).toHaveLength(1);
        expect(report.config.projects[0].name).toBe('chromium');
        expect(report.config.projects[0].retries).toBe(0);
        expect(report.config.workers).toBe(1);
        expect(report.config.webServer).toBeNull();
    });

    it('executes helper regressions in CI, not just discovery', () => {
        const steps = workflow().jobs.e2e.steps;
        assertHelperBrowserInstallOrder(steps);

        const withoutChromiumInstall = steps.filter((entry) => entry.name !== 'Install Chromium browser');
        expect(() => assertHelperBrowserInstallOrder(withoutChromiumInstall)).toThrow();

        const noOpFirefoxInstall = steps.map((entry) => entry.name === 'Install Firefox after Chromium screenshot gates'
            ? { ...entry, run: 'true' }
            : entry);
        expect(() => assertHelperBrowserInstallOrder(noOpFirefoxInstall)).toThrow();
    });
});
