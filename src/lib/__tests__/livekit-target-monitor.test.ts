import { createServer, type Server } from 'node:http';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/livekit-target-monitor.py');
const temporaryRoots: string[] = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'hb-target-monitor-'));
  temporaryRoots.push(root);
  return root;
}

function fakeDocker(root: string) {
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const executable = join(bin, 'docker');
  const environmentCapture = join(root, 'docker-environment');
  writeFileSync(executable, [
    '#!/bin/sh',
    `env > '${environmentCapture}'`,
    'case "$1" in',
    '  stats)',
    "    printf '%s\\n' '{\"Name\":\"beacon-app\",\"CPUPerc\":\"12.50%\",\"MemUsage\":\"1MiB / 2GiB\",\"NetIO\":\"3MB / 4MB\",\"PIDs\":\"7\"}'",
    "    printf '%s\\n' '{\"Name\":\"beacon-livekit\",\"CPUPerc\":\"4.25%\",\"MemUsage\":\"2MiB / 2GiB\",\"NetIO\":\"5MB / 6MB\",\"PIDs\":\"9\"}'",
    '    ;;',
    '  inspect)',
    "    printf '/beacon-app\\t2\\trunning\\tfalse\\thealthy\\n'",
    "    printf '/beacon-livekit\\t3\\trunning\\tfalse\\tnone\\n'",
    '    ;;',
    '  *) exit 9 ;;',
    'esac',
  ].join('\n'));
  chmodSync(executable, 0o755);
  return { bin, environmentCapture };
}

async function healthyServer(): Promise<{ server: Server; url: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/redirect-target' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing test server port');
  return { server, url: `http://127.0.0.1:${address.port}/ready`, requests };
}

function records(path: string) {
  return readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for monitor evidence');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function runPython(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn('python3', args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
  return { status, stdout, stderr };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('LiveKit target-side monitor', () => {
  it('writes bounded, credential-free target telemetry and a final summary', async () => {
    const root = temporaryRoot();
    const { bin, environmentCapture } = fakeDocker(root);
    const output = join(root, 'evidence', 'monitor.jsonl');
    const { server, url } = await healthyServer();
    try {
      const result = await runPython([
        script,
        '--output', output,
        '--run-id', 'target-monitor-test',
        '--duration-seconds', '0.65',
        '--interval-seconds', '0.2',
        '--health-url', url,
        '--network-interface', 'lo',
        '--container', 'beacon-app',
        '--container', 'beacon-livekit',
      ], {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TARGET_MONITOR_SECRET_SENTINEL: 'must-not-appear',
      });

      expect(result.status, result.stderr).toBe(0);
      expect(statSync(output).mode & 0o777).toBe(0o600);
      const raw = readFileSync(output, 'utf8');
      expect(raw).not.toContain('must-not-appear');
      expect(readFileSync(environmentCapture, 'utf8')).not.toContain(
        'TARGET_MONITOR_SECRET_SENTINEL',
      );
      const evidence = records(output);
      expect(evidence[0]).toMatchObject({
        schemaVersion: 1,
        kind: 'harmonic-beacon-livekit-target-monitor',
        recordType: 'header',
        healthTarget: 'loopback',
        containers: ['beacon-app', 'beacon-livekit'],
      });
      const samples = evidence.filter((record) => record.recordType === 'sample');
      expect(samples.length).toBeGreaterThanOrEqual(2);
      expect(samples[0].health).toMatchObject({ ok: true, status: 200 });
      expect(samples[0].containers[0]).toMatchObject({
        name: 'beacon-app',
        available: true,
        cpuPercent: 12.5,
        memoryUsageBytes: 1_048_576,
        memoryLimitBytes: 2_147_483_648,
        networkRxBytes: 3_000_000,
        networkTxBytes: 4_000_000,
        restartCount: 2,
        oomKilled: false,
        health: 'healthy',
      });
      expect(samples[0].containers[1]).toMatchObject({
        name: 'beacon-livekit',
        available: true,
        cpuPercent: 4.25,
        restartCount: 3,
        health: null,
      });
      expect(evidence.at(-1)).toMatchObject({
        recordType: 'summary',
        interrupted: false,
        signal: null,
        healthFailures: 0,
        containerMaxCpuPercent: { 'beacon-app': 12.5, 'beacon-livekit': 4.25 },
        containerRestartDelta: { 'beacon-app': 0, 'beacon-livekit': 0 },
        oomObserved: false,
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 10_000);

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('preserves a summary for %s with exit %i', async (sentSignal, expectedExit) => {
    const root = temporaryRoot();
    const { bin } = fakeDocker(root);
    const output = join(root, 'interrupted.jsonl');
    const { server, url } = await healthyServer();
    try {
      const child = spawn('python3', [
        script,
        '--output', output,
        '--run-id', 'target-monitor-interrupt',
        '--duration-seconds', '20',
        '--interval-seconds', '0.2',
        '--health-url', url,
        '--network-interface', 'lo',
        '--container', 'beacon-app',
      ], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      await waitUntil(() => existsSync(output) && readFileSync(output, 'utf8').includes('"recordType":"sample"'));
      child.kill(sentSignal);
      const exitCode = await new Promise<number | null>((resolve) => child.on('close', resolve));

      expect(exitCode, stderr).toBe(expectedExit);
      const evidence = records(output);
      expect(evidence.at(-1)).toMatchObject({
        recordType: 'summary',
        interrupted: true,
        signal: sentSignal,
        healthFailures: 0,
      });
      expect(statSync(output).mode & 0o777).toBe(0o600);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 10_000);

  it('records a loopback redirect as unhealthy without following it', async () => {
    const root = temporaryRoot();
    const { bin } = fakeDocker(root);
    const output = join(root, 'redirect.jsonl');
    const { server, url, requests } = await healthyServer();
    try {
      const result = await runPython([
        script,
        '--output', output,
        '--run-id', 'target-monitor-redirect',
        '--duration-seconds', '0.25',
        '--interval-seconds', '0.2',
        '--health-url', url.replace('/ready', '/redirect'),
        '--network-interface', 'lo',
        '--container', 'beacon-app',
      ], { ...process.env, PATH: `${bin}:${process.env.PATH}` });

      expect(result.status, result.stderr).toBe(0);
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(new Set(requests)).toEqual(new Set(['/redirect']));
      const evidence = records(output);
      expect(evidence[1].health).toMatchObject({ ok: false, status: 302, error: 'http' });
      expect(evidence.at(-1)).toMatchObject({ healthFailures: requests.length });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it.each([
    'https://user:password@example.com/ready',
    'http://127.0.0.1/ready?token=secret',
  ])('refuses remote or credential-bearing health URL %s before opening evidence', (url) => {
    const root = temporaryRoot();
    const output = join(root, 'refused.jsonl');
    const result = spawnSync('python3', [
      script,
      '--output', output,
      '--run-id', 'target-monitor-refusal',
      '--duration-seconds', '1',
      '--health-url', url,
      '--container', 'beacon-app',
    ], { encoding: 'utf8', timeout: 5_000 });

    expect(result.status).toBe(2);
    expect(existsSync(output)).toBe(false);
  });
});
