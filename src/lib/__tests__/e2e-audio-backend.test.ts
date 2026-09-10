import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('provides an isolated, fail-closed audio backend before Firefox and WebKit', () => {
    const workflow = readFileSync('.github/workflows/e2e.yml', 'utf8');
    const heading = '      - name: Start isolated browser audio backend\n';
    const position = workflow.indexOf(heading);
    expect(position, 'required Firefox audio backend is absent').toBeGreaterThan(-1);
    expect(position).toBeLessThan(workflow.indexOf('      - name: Run Firefox functional and accessibility gates\n'));
    expect(position).toBeLessThan(workflow.indexOf('      - name: Run iPhone/WebKit media gate\n'));
    const step = workflow.split(heading)[1].split('\n      - ')[0];
    expect(step).not.toContain('if:');
    expect(step).not.toContain('continue-on-error:');
    const script = step.split('        run: |\n')[1].split('\n').map(line => line.slice(10)).join('\n');
    // Run the actual workflow shell with an isolated PATH, never host services.
    // Both daemon startup and health failures must prevent exporting the backend.
    for (const failure of ['none', 'pulseaudio', 'pactl', 'missing-root']) {
        const directory = mkdtempSync(join(tmpdir(), 'hb-audio-backend-'));
        const environmentFile = join(directory, 'github-env');
        try {
            writeFileSync(join(directory, 'sudo'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
            writeFileSync(join(directory, 'pulseaudio'), '#!/bin/sh\n[ "$FIXTURE_FAIL" != pulseaudio ]\n', { mode: 0o700 });
            writeFileSync(join(directory, 'pactl'), '#!/bin/sh\n[ "$PULSE_SERVER" = "unix:$BEACON_CI_ROOT/native" ] && [ "$FIXTURE_FAIL" != pactl ]\n', { mode: 0o700 });
            const result = spawnSync('/bin/bash', ['-c', script], {
                encoding: 'utf8',
                env: { NODE_ENV: 'test', PATH: directory, RUNNER_TEMP: directory, BEACON_CI_ROOT: failure === 'missing-root' ? undefined : directory, GITHUB_ENV: environmentFile, FIXTURE_FAIL: failure },
            });
            expect(result.error).toBeUndefined();
            if (failure === 'none') {
                expect(result.status, result.stderr).toBe(0);
                expect(readFileSync(environmentFile, 'utf8')).toBe(`PULSE_SERVER=unix:${directory}/native\n`);
            } else {
                expect(result.status, `${failure} must fail closed`).not.toBe(0);
                expect(existsSync(environmentFile)).toBe(false);
            }
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }
});
