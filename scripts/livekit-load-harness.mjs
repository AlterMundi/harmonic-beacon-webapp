#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { RoomServiceClient } from 'livekit-server-sdk';

import {
    buildPlan,
    commandFingerprint,
    createAbortCoordinator,
    manifestContainsSecret,
    parseLoadTestOutput,
    remoteConfirmation,
} from './lib/livekit-load-harness.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_TAIL_LIMIT = 1024 * 1024;

function appendOutputTail(current, chunk) {
    const next = current + chunk.toString();
    return next.length > OUTPUT_TAIL_LIMIT ? next.slice(-OUTPUT_TAIL_LIMIT) : next;
}

async function readGeneratorResources() {
    try {
        const [stat, meminfo, netdev] = await Promise.all([
            readFile('/proc/stat', 'utf8'),
            readFile('/proc/meminfo', 'utf8'),
            readFile('/proc/net/dev', 'utf8'),
        ]);
        const cpu = stat.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
        const memoryMatch = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
        let networkRxBytes = 0;
        let networkTxBytes = 0;
        for (const line of netdev.split('\n').slice(2)) {
            const [interfaceName, counters] = line.split(':');
            if (!counters || interfaceName.trim() === 'lo') continue;
            const values = counters.trim().split(/\s+/).map(Number);
            networkRxBytes += values[0] ?? 0;
            networkTxBytes += values[8] ?? 0;
        }
        return {
            cpuTotal: cpu.reduce((sum, value) => sum + value, 0),
            cpuIdle: (cpu[3] ?? 0) + (cpu[4] ?? 0),
            memoryAvailableBytes: memoryMatch ? Number(memoryMatch[1]) * 1024 : null,
            networkRxBytes,
            networkTxBytes,
        };
    } catch {
        return null;
    }
}

function summarizeGeneratorResources(before, after) {
    if (!before || !after) return { available: false };
    const totalDelta = after.cpuTotal - before.cpuTotal;
    const idleDelta = after.cpuIdle - before.cpuIdle;
    return {
        available: true,
        cpuBusyPercent: totalDelta > 0
            ? Number(((1 - idleDelta / totalDelta) * 100).toFixed(2))
            : null,
        memoryAvailableBeforeBytes: before.memoryAvailableBytes,
        memoryAvailableAfterBytes: after.memoryAvailableBytes,
        networkRxBytes: after.networkRxBytes - before.networkRxBytes,
        networkTxBytes: after.networkTxBytes - before.networkTxBytes,
    };
}

function nanosecondsToMilliseconds(value) {
    return Number.isFinite(value) ? Number((value / 1_000_000).toFixed(3)) : null;
}

function option(name, fallback = undefined) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

function generatedRunId() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'z').toLowerCase();
}

async function generatorHostFingerprint() {
    let machineId = '';
    try {
        machineId = (await readFile('/etc/machine-id', 'utf8')).trim();
    } catch {
        // Hostname-only fallback remains opaque; the aggregate still refuses
        // duplicate hashes rather than claiming independent generators.
    }
    return commandFingerprint([hostname(), machineId]).slice(0, 12);
}

function installAbortHandlers(abort) {
    const onSigint = () => {
        if (abort.request('SIGINT')) {
            process.stderr.write('\nSIGINT received; stopping load and preserving an ABORTED manifest.\n');
        }
    };
    const onSigterm = () => {
        if (abort.request('SIGTERM')) {
            process.stderr.write('\nSIGTERM received; stopping load and preserving an ABORTED manifest.\n');
        }
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    return () => {
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
    };
}

async function waitBetweenPhases(seconds, abort) {
    const deadline = Date.now() + seconds * 1000;
    while (!abort.requested && Date.now() < deadline) {
        await new Promise((resolvePromise) => setTimeout(
            resolvePromise,
            Math.min(250, deadline - Date.now()),
        ));
    }
}

async function waitForScheduledPhase(startAt, offsetSeconds, abort) {
    if (startAt === null) {
        return { passed: true, scheduledFor: null, observedAt: null, lateByMs: null };
    }
    const target = Date.parse(startAt) + offsetSeconds * 1000;
    while (!abort.requested && Date.now() < target) {
        await new Promise((resolvePromise) => setTimeout(
            resolvePromise,
            Math.min(250, target - Date.now()),
        ));
    }
    const lateByMs = Date.now() - target;
    return {
        passed: abort.requested || lateByMs <= 5_000,
        scheduledFor: new Date(target).toISOString(),
        observedAt: new Date().toISOString(),
        lateByMs,
    };
}

function printHelp() {
    process.stdout.write(`Usage: npm run load:livekit -- [options]\n\n` +
        `  --profile NAME             ci, rehearsal-es, or rehearsal-en\n` +
        `  --run-id ID                synthetic namespace recorded in the manifest\n` +
        `  --url URL                  LiveKit URL (default LIVEKIT_URL or localhost)\n` +
        `  --lk-bin PATH              pinned LiveKit CLI executable (default lk)\n` +
        `  --manifest PATH            output JSON path\n` +
        `  --shard-index NUMBER       zero-based generator shard (default 0)\n` +
        `  --shard-count NUMBER       total generator shards (default 1)\n` +
        `  --start-at UTC             shared future UTC start required for sharding\n` +
        `  --dry-run                  validate and write a PLANNED manifest only\n` +
        `  --allow-remote             acknowledge a non-local target\n` +
        `  --confirm-test-rooms VALUE exact room confirmation required remotely\n`);
}

async function commandOutput(command, args) {
    return new Promise((resolvePromise) => {
        const child = spawn(command, args, { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (chunk) => { output = appendOutputTail(output, chunk); });
        child.stderr.on('data', (chunk) => { output = appendOutputTail(output, chunk); });
        child.on('error', (error) => resolvePromise({ exitCode: 127, output: error.message }));
        child.on('close', (exitCode) => resolvePromise({ exitCode: exitCode ?? 1, output }));
    });
}

async function runLoad(lkBinary, args, credentials, abort) {
    const startedAt = new Date();
    if (abort.requested) {
        return {
            exitCode: abort.exitCode(),
            operatorAborted: true,
            terminationSignal: abort.snapshot()?.signal ?? null,
            startedAt: startedAt.toISOString(),
            endedAt: startedAt.toISOString(),
            durationMs: 0,
            summary: parseLoadTestOutput(''),
        };
    }
    return new Promise((resolvePromise) => {
        const child = spawn(lkBinary, args, {
            cwd: repositoryRoot,
            env: {
                ...process.env,
                LIVEKIT_URL: credentials.url,
                LIVEKIT_API_KEY: credentials.apiKey,
                LIVEKIT_API_SECRET: credentials.apiSecret,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const untrack = abort.track(child);
        let output = '';
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            untrack();
            resolvePromise(result);
        };
        child.stdout.on('data', (chunk) => {
            output = appendOutputTail(output, chunk);
            process.stdout.write(chunk);
        });
        child.stderr.on('data', (chunk) => {
            output = appendOutputTail(output, chunk);
            process.stderr.write(chunk);
        });
        child.on('error', (error) => {
            finish({
                exitCode: 127,
                error: error.message,
                operatorAborted: abort.requested,
                terminationSignal: abort.snapshot()?.signal ?? null,
                startedAt: startedAt.toISOString(),
                endedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt.getTime(),
                summary: parseLoadTestOutput(output),
            });
        });
        child.on('close', (exitCode, terminationSignal) => {
            finish({
                exitCode: exitCode ?? (abort.requested ? abort.exitCode() : 1),
                operatorAborted: abort.requested,
                terminationSignal: terminationSignal ?? null,
                startedAt: startedAt.toISOString(),
                endedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt.getTime(),
                summary: parseLoadTestOutput(output),
            });
        });
    });
}

function percentile(values, percentileValue) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
}

function summarizeObservedRoom(observed, expectedConnections, expectedPublishers) {
    return {
        expectedConnections,
        peakConnections: observed.peakConnections,
        expectedPublishers,
        peakPublishers: observed.peakPublishers,
        peakTracks: observed.peakTracks,
        joinObserved: observed.joinOffsetsMs.length,
        joinMs: {
            p50: percentile(observed.joinOffsetsMs, 0.5),
            p95: percentile(observed.joinOffsetsMs, 0.95),
            p99: percentile(observed.joinOffsetsMs, 0.99),
        },
    };
}

function loadResultPassed(result, expectedSubscriberTracks, profile) {
    return result.exitCode === 0 &&
        result.summary.parsed &&
        result.summary.tracksReceived === expectedSubscriberTracks &&
        result.summary.droppedPercent <= profile.maxDroppedPercent &&
        (result.summary.errorCount === null || result.summary.errorCount === 0);
}

async function monitorRooms(roomService, phase, stopped) {
    const startedAt = Date.now();
    const rooms = {
        stage: { seen: new Set(), joinOffsetsMs: [], peakConnections: 0, peakPublishers: 0, peakTracks: 0 },
        beacon: { seen: new Set(), joinOffsetsMs: [], peakConnections: 0, peakPublishers: 0, peakTracks: 0 },
    };
    let apiErrors = 0;
    let successfulSamples = 0;
    while (!stopped.value) {
        for (const [kind, roomName] of Object.entries({
            stage: phase.stage.roomName,
            beacon: phase.beacon.roomName,
        })) {
            try {
                const participants = await roomService.listParticipants(roomName);
                successfulSamples += 1;
                const observed = rooms[kind];
                observed.peakConnections = Math.max(observed.peakConnections, participants.length);
                observed.peakPublishers = Math.max(
                    observed.peakPublishers,
                    participants.filter((participant) => participant.tracks.length > 0).length,
                );
                observed.peakTracks = Math.max(
                    observed.peakTracks,
                    participants.reduce((sum, participant) => sum + participant.tracks.length, 0),
                );
                for (const participant of participants) {
                    if (!observed.seen.has(participant.sid)) {
                        observed.seen.add(participant.sid);
                        observed.joinOffsetsMs.push(Date.now() - startedAt);
                    }
                }
            } catch {
                apiErrors += 1;
            }
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    return {
        apiErrors,
        successfulSamples,
        stage: summarizeObservedRoom(
            rooms.stage,
            phase.stage.expectedGlobalConnections,
            phase.profileStagePublishers,
        ),
        beacon: summarizeObservedRoom(
            rooms.beacon,
            phase.beacon.expectedGlobalConnections,
            phase.profileBeaconPublishers,
        ),
    };
}

async function waitForCleanup(roomService, roomNames, timeoutMs = 10_000) {
    const startedAt = Date.now();
    let remaining = { stage: null, beacon: null };
    do {
        try {
            const [stage, beacon] = await Promise.all([
                roomService.listParticipants(roomNames.stage),
                roomService.listParticipants(roomNames.beacon),
            ]);
            remaining = { stage: stage.length, beacon: beacon.length };
            if (stage.length === 0 && beacon.length === 0) {
                return { passed: true, convergenceMs: Date.now() - startedAt, remaining };
            }
        } catch {
            // Empty rooms can disappear between list calls. Retry until the
            // bounded deadline so an API hiccup is never mistaken for clean.
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    } while (Date.now() - startedAt < timeoutMs);
    return { passed: false, convergenceMs: Date.now() - startedAt, remaining };
}

function publicPlan(plan, lkBinary) {
    const executable = basename(lkBinary);
    return {
        ...plan,
        phases: plan.phases.map((phase) => ({
            ...phase,
            stage: {
                requestedConnections: phase.stage.requestedConnections,
                expectedGlobalConnections: phase.stage.expectedGlobalConnections,
                localPublishers: phase.stage.localPublishers,
                expectedGlobalPublishers: phase.stage.expectedGlobalPublishers,
                expectedSubscriberTracks: phase.stage.expectedSubscriberTracks,
                command: `${executable} ${phase.stage.args.join(' ')}`,
                fingerprint: commandFingerprint(phase.stage.args),
            },
            beacon: {
                requestedConnections: phase.beacon.requestedConnections,
                expectedGlobalConnections: phase.beacon.expectedGlobalConnections,
                localPublishers: phase.beacon.localPublishers,
                expectedGlobalPublishers: phase.beacon.expectedGlobalPublishers,
                expectedSubscriberTracks: phase.beacon.expectedSubscriberTracks,
                command: `${executable} ${phase.beacon.args.join(' ')}`,
                fingerprint: commandFingerprint(phase.beacon.args),
            },
        })),
    };
}

async function main() {
    if (hasFlag('--help') || hasFlag('-h')) {
        printHelp();
        return;
    }
    const profileName = option('--profile', 'ci');
    const runId = option('--run-id', generatedRunId());
    const url = option('--url', process.env.LIVEKIT_URL ?? 'ws://localhost:7880');
    const lkBinary = option('--lk-bin', process.env.LK_BIN ?? 'lk');
    const dryRun = hasFlag('--dry-run');
    const shardIndex = Number(option('--shard-index', '0'));
    const shardCount = Number(option('--shard-count', '1'));
    const startAt = option('--start-at', '');
    const profilesPath = resolve(repositoryRoot, 'config/livekit-load-profiles.json');
    const profilesDocument = JSON.parse(await readFile(profilesPath, 'utf8'));
    const profile = profilesDocument.profiles?.[profileName];
    if (!profile) throw new Error(`unknown profile: ${profileName}`);
    const plan = buildPlan({
        profileName,
        profile,
        runId,
        url,
        allowRemote: hasFlag('--allow-remote'),
        confirmation: option('--confirm-test-rooms', ''),
        shardIndex,
        shardCount,
        startAt,
    });
    if (!dryRun && plan.scheduledStartAt !== null && Date.parse(plan.scheduledStartAt) - Date.now() < 30_000) {
        throw new Error('startAt must be at least 30 seconds in the future');
    }
    const shardFileSuffix = plan.shard.count === 1
        ? ''
        : `-shard-${plan.shard.index}-of-${plan.shard.count}`;
    const manifestPath = resolve(
        repositoryRoot,
        option('--manifest', `artifacts/load-test/${plan.runId}-${profileName}${shardFileSuffix}.json`),
    );
    const [git, gitStatus, lk] = await Promise.all([
        commandOutput('git', ['rev-parse', 'HEAD']),
        commandOutput('git', ['status', '--porcelain']),
        dryRun ? Promise.resolve({ exitCode: 0, output: 'not checked in dry-run' }) : commandOutput(lkBinary, ['--version']),
    ]);
    const manifest = {
        schemaVersion: 1,
        kind: 'harmonic-beacon-livekit-load',
        status: dryRun ? 'PLANNED' : 'RUNNING',
        generatedAt: new Date().toISOString(),
        harnessSha: git.output.trim() || 'unknown',
        livekitCliVersion: lk.output.trim() || 'unknown',
        harnessDirty: gitStatus.output.trim().length > 0,
        generatorHostHash: await generatorHostFingerprint(),
        plan: publicPlan(plan, lkBinary),
        limitations: [
            'Protocol clients measure SFU capacity; they do not certify browser DOM, decode, physical speaker routing, or perceived audio quality.',
            'Load-test summary latency is media latency, not per-user application login latency.',
            'Physical iOS, Android, Bluetooth, TURN, and six-camera evidence remains in issue #24.',
        ],
        phases: [],
    };
    let abort = null;

    if (!dryRun) {
        const credentials = {
            url,
            apiKey: process.env.LIVEKIT_API_KEY ?? '',
            apiSecret: process.env.LIVEKIT_API_SECRET ?? '',
        };
        if (!credentials.apiKey || !credentials.apiSecret) {
            throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required');
        }
        if (lk.exitCode !== 0) throw new Error(`LiveKit CLI unavailable: ${lk.output.trim()}`);
        abort = createAbortCoordinator();
        const removeAbortHandlers = installAbortHandlers(abort);
        const roomService = new RoomServiceClient(
            url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'),
            credentials.apiKey,
            credentials.apiSecret,
        );
        for (const [index, phase] of plan.phases.entries()) {
            if (abort.requested) break;
            const synchronization = await waitForScheduledPhase(
                plan.scheduledStartAt,
                phase.scheduledOffsetSeconds,
                abort,
            );
            if (abort.requested) break;
            if (!synchronization.passed) {
                manifest.status = 'FAIL';
                manifest.phases.push({
                    name: phase.name,
                    passed: false,
                    reason: 'missed-synchronized-start',
                    synchronization,
                });
                break;
            }
            process.stdout.write(`\n[${phase.name}] starting stage and Beacon load\n`);
            const resourceBefore = await readGeneratorResources();
            const eventLoop = monitorEventLoopDelay({ resolution: 20 });
            eventLoop.enable();
            const stopped = { value: false };
            const monitor = monitorRooms(roomService, {
                ...phase,
                profileStagePublishers: profile.stagePublishers,
                profileBeaconPublishers: profile.beaconPublishers,
            }, stopped);
            const [stage, beacon] = await Promise.all([
                runLoad(lkBinary, phase.stage.args, credentials, abort),
                runLoad(lkBinary, phase.beacon.args, credentials, abort),
            ]);
            stopped.value = true;
            const observed = await monitor;
            const cleanup = await waitForCleanup(roomService, plan.rooms);
            eventLoop.disable();
            const resourceAfter = await readGeneratorResources();
            const generatorResources = {
                ...summarizeGeneratorResources(resourceBefore, resourceAfter),
                eventLoopDelayMs: {
                    mean: nanosecondsToMilliseconds(eventLoop.mean),
                    p95: nanosecondsToMilliseconds(eventLoop.percentile(95)),
                    p99: nanosecondsToMilliseconds(eventLoop.percentile(99)),
                    max: nanosecondsToMilliseconds(eventLoop.max),
                },
            };
            const passed = !abort.requested &&
                loadResultPassed(stage, phase.stage.expectedSubscriberTracks, profile) &&
                loadResultPassed(beacon, phase.beacon.expectedSubscriberTracks, profile) &&
                observed.apiErrors === 0 &&
                observed.successfulSamples > 0 &&
                observed.stage.peakConnections === phase.stage.expectedGlobalConnections &&
                observed.stage.joinObserved === phase.stage.expectedGlobalConnections &&
                observed.stage.peakPublishers === profile.stagePublishers &&
                observed.beacon.peakConnections === phase.beacon.expectedGlobalConnections &&
                observed.beacon.joinObserved === phase.beacon.expectedGlobalConnections &&
                observed.beacon.peakPublishers === profile.beaconPublishers &&
                cleanup.passed;
            manifest.phases.push({
                name: phase.name,
                passed,
                operatorAborted: abort.requested,
                synchronization,
                stage,
                beacon,
                observed,
                cleanup,
                generatorResources,
            });
            if (abort.requested) break;
            if (!passed) manifest.status = 'FAIL';
            if (index < plan.phases.length - 1 && plan.scheduledStartAt === null && profile.interWaveSeconds > 0) {
                await waitBetweenPhases(profile.interWaveSeconds, abort);
            }
        }
        removeAbortHandlers();
        if (abort.requested) {
            manifest.status = 'ABORTED';
            manifest.abort = abort.snapshot();
        } else if (manifest.status !== 'FAIL') {
            manifest.status = 'PASS';
        }
        if (manifestContainsSecret(manifest, [credentials.apiKey, credentials.apiSecret])) {
            throw new Error('refusing to write a manifest containing a credential');
        }
    }

    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`\nManifest: ${manifestPath}\nStatus: ${manifest.status}\n`);
    if (plan.target === 'remote-explicit') {
        process.stdout.write(`Remote confirmation used: ${remoteConfirmation(plan.rooms)}\n`);
    }
    if (manifest.status === 'FAIL') process.exitCode = 1;
    if (manifest.status === 'ABORTED') process.exitCode = abort.exitCode();
}

main().catch((error) => {
    process.stderr.write(`load harness refused or failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
