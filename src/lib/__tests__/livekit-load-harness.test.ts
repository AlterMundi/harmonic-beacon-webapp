import {
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import {
    aggregateShardManifests,
    assertSafeTarget,
    buildDistributedDispatchPlan,
    buildPlan,
    connectionRampSeconds,
    createAbortCoordinator,
    createConsecutiveFailureGuard,
    generatorHostFingerprint,
    manifestContainsSecret,
    normalizeScheduledStart,
    partitionCount,
    parseLoadTestOutput,
    probeProductionReadiness,
    PRODUCTION_READINESS_URL,
    remoteConfirmation,
    roomNames,
    validateProfile,
    validateShard,
    validateDistributedTargetUrl,
} from '../../../scripts/lib/livekit-load-harness.mjs';

const profile = {
    eventLanguage: 'es',
    attendees: 150,
    stagePublishers: 6,
    beaconPublishers: 1,
    stageVideoCodec: 'vp8',
    stageLayout: 'speaker',
    rampPerSecond: 10,
    rampDurationSeconds: 60,
    soakDurationSeconds: 1200,
    reconnectDurationSeconds: 60,
    reconnectWaves: 2,
    reconnectMode: 'staggered',
    interWaveSeconds: 10,
    maxDroppedPercent: 0.1,
};
const temporaryRoots: string[] = [];

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function passingShardManifest(plan: ReturnType<typeof buildPlan>, hostIndex: number) {
    return {
        schemaVersion: 1,
        kind: 'harmonic-beacon-livekit-load',
        status: 'PASS',
        harnessSha: '0123456789abcdef0123456789abcdef01234567',
        livekitCliVersion: 'lk 2.16.3',
        harnessDirty: false,
        generatorHostHash: String(hostIndex).padStart(12, '0'),
        plan,
        phases: plan.phases.map((plannedPhase) => ({
            name: plannedPhase.name,
            passed: true,
            operatorAborted: false,
            synchronization: {
                passed: true,
                scheduledFor: new Date(
                    Date.parse(plan.scheduledStartAt ?? '') +
                    plannedPhase.scheduledOffsetSeconds * 1000,
                ).toISOString(),
                observedAt: new Date(
                    Date.parse(plan.scheduledStartAt ?? '') +
                    plannedPhase.scheduledOffsetSeconds * 1000,
                ).toISOString(),
                lateByMs: 0,
            },
            stage: {
                exitCode: 0,
                startedAt: new Date(
                    Date.parse(plan.scheduledStartAt ?? '') +
                    plannedPhase.scheduledOffsetSeconds * 1000,
                ).toISOString(),
                summary: {
                    parsed: true,
                    tracksReceived: plannedPhase.stage.expectedSubscriberTracks,
                    tracksExpected: plan.shard.localAttendees * plan.shard.localStagePublishers,
                    droppedPercent: 0,
                    errorCount: 0,
                },
            },
            beacon: {
                exitCode: 0,
                startedAt: new Date(
                    Date.parse(plan.scheduledStartAt ?? '') +
                    plannedPhase.scheduledOffsetSeconds * 1000,
                ).toISOString(),
                summary: {
                    parsed: true,
                    tracksReceived: plannedPhase.beacon.expectedSubscriberTracks,
                    tracksExpected: plan.shard.localAttendees * plan.shard.localBeaconPublishers,
                    droppedPercent: 0,
                    errorCount: 0,
                },
            },
            observed: {
                apiErrors: 0,
                successfulSamples: 2,
                stage: {
                    expectedConnections: plannedPhase.stage.expectedGlobalConnections,
                    peakConnections: plannedPhase.stage.expectedGlobalConnections,
                    joinObserved: plannedPhase.stage.expectedGlobalConnections,
                    expectedPublishers: plannedPhase.stage.expectedGlobalPublishers,
                    peakPublishers: plannedPhase.stage.expectedGlobalPublishers,
                },
                beacon: {
                    expectedConnections: plannedPhase.beacon.expectedGlobalConnections,
                    peakConnections: plannedPhase.beacon.expectedGlobalConnections,
                    joinObserved: plannedPhase.beacon.expectedGlobalConnections,
                    expectedPublishers: plannedPhase.beacon.expectedGlobalPublishers,
                    peakPublishers: plannedPhase.beacon.expectedGlobalPublishers,
                },
            },
            cleanup: { passed: true },
        })),
    };
}

describe('LiveKit load harness safety', () => {
    it('probes only the fixed public production readiness boundary', async () => {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init: init ?? {} });
            return { status: 200 } as Response;
        };

        await expect(probeProductionReadiness({ fetchImpl })).resolves.toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            url: PRODUCTION_READINESS_URL,
            init: { method: 'GET', cache: 'no-store', redirect: 'manual' },
        });
        expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    });

    it('fails closed on non-200 responses and probe errors', async () => {
        await expect(probeProductionReadiness({
            fetchImpl: async () => ({ status: 503 }) as Response,
        })).resolves.toBe(false);
        await expect(probeProductionReadiness({
            fetchImpl: async () => { throw new Error('network unavailable'); },
        })).resolves.toBe(false);
    });

    it('trips after two consecutive failures but resets after a success', () => {
        let trips = 0;
        const guard = createConsecutiveFailureGuard({
            maxFailures: 2,
            onTrip: () => { trips += 1; },
        });

        expect(guard.record(false)).toBe(false);
        expect(guard.failures).toBe(1);
        expect(guard.record(true)).toBe(false);
        expect(guard.failures).toBe(0);
        expect(guard.record(false)).toBe(false);
        expect(guard.record(false)).toBe(true);
        expect(guard.record(true)).toBe(true);
        expect(trips).toBe(1);
    });

    it('builds a bounded two-host dispatch without exposing target credentials', () => {
        const dispatch = buildDistributedDispatchPlan({
            profileName: 'rehearsal-es',
            profile,
            runId: 'github-run-a',
            targetUrl: 'ws://144.217.90.60:7890',
            startDelaySeconds: 1200,
            nowMs: Date.parse('2026-08-05T12:00:00Z'),
        });
        expect(dispatch).toMatchObject({
            runId: 'github-run-a',
            shardCount: 2,
            startAt: '2026-08-05T12:20:00.000Z',
            targetHost: '144.217.90.60',
            rooms: {
                stage: 'hb-load-github-run-a-es-stage',
                beacon: 'hb-load-github-run-a-es-beacon',
            },
        });
        expect(dispatch.expectedEndAt).toBe('2026-08-05T12:44:49.000Z');
        expect(JSON.stringify(dispatch)).not.toContain('secret');
        expect(dispatch.confirmation).toBe(
            'LOADTEST:hb-load-github-run-a-es-stage:hb-load-github-run-a-es-beacon',
        );
    });

    it('refuses unsafe distributed targets, timing and topology', () => {
        for (const unsafe of [
            'https://example.test',
            'ws://localhost:7890',
            'ws://key:secret@example.test:7890',
            'ws://example.test:7890/path',
            'ws://example.test:7890?token=secret',
            'ws://example.test:7890#fragment',
        ]) {
            expect(() => validateDistributedTargetUrl(unsafe)).toThrow();
        }
        expect(validateDistributedTargetUrl('wss://load.example.test'))
            .toBe('wss://load.example.test');
        expect(() => buildDistributedDispatchPlan({
            profileName: 'rehearsal-es', profile, runId: 'github-run-a',
            targetUrl: 'ws://example.test:7890', startDelaySeconds: 599,
        })).toThrow(/start delay/);
        expect(() => buildDistributedDispatchPlan({
            profileName: 'rehearsal-es', profile, runId: 'github-run-a',
            targetUrl: 'ws://example.test:7890', startDelaySeconds: 1200, shardCount: 3,
        })).toThrow(/exactly two shards/);
    });

    it('builds two synthetic connections per attendee and caps the stage at six publishers', () => {
        const plan = buildPlan({
            profileName: 'rehearsal-es',
            profile,
            runId: 'event-weekend',
            url: 'ws://localhost:7880',
        });
        expect(plan.rooms).toEqual({
            stage: 'hb-load-event-weekend-es-stage',
            beacon: 'hb-load-event-weekend-es-beacon',
        });
        expect(plan.phases.map((phase) => phase.name)).toEqual([
            'ramp', 'soak', 'reconnect-1', 'reconnect-2',
        ]);
        expect(plan.phases[0].stage.requestedConnections).toBe(156);
        expect(plan.phases[0].beacon.requestedConnections).toBe(151);
        expect(plan.phases[0].stage.args).toContain('6');
        expect(plan.phases[0].beacon.args).toContain('1');
        expect(plan.phases[0].stage.args).toContain('hbload-event-weekend-stage');
        expect(plan.phases[0].stage.args).toContain('vp8');
        expect(plan.phases[0].stage.args).toContain('speaker');
        expect(plan.phases[2].stage.args).toContain('hbload-event-weekend-stage');
    });

    it('partitions attendees, publishers and ramp exactly across synchronized shards', () => {
        const startAt = '2026-08-06T12:00:00.000Z';
        const shards = [0, 1].map((shardIndex) => buildPlan({
            profileName: 'rehearsal-es',
            profile,
            runId: 'event-weekend',
            url: 'ws://localhost:7880',
            shardIndex,
            shardCount: 2,
            startAt,
        }));

        expect(shards[0].rooms).toEqual(shards[1].rooms);
        expect(shards.map((plan) => plan.scheduledStartAt)).toEqual([startAt, startAt]);
        expect(shards.map((plan) => plan.shard.localAttendees)).toEqual([75, 75]);
        expect(shards.map((plan) => plan.shard.localStagePublishers)).toEqual([3, 3]);
        expect(shards.map((plan) => plan.shard.localBeaconPublishers)).toEqual([1, 0]);
        expect(shards.map((plan) => plan.shard.localRampPerSecond)).toEqual([5, 5]);
        expect(shards.map((plan) => plan.phases[0].stage.requestedConnections)).toEqual([78, 78]);
        expect(shards.map((plan) => plan.phases[0].beacon.requestedConnections)).toEqual([76, 75]);
        expect(shards[0].phases[0].stage.expectedGlobalConnections).toBe(156);
        expect(shards[1].phases[0].beacon.expectedGlobalConnections).toBe(151);
        expect(shards[0].phases[0].stage.expectedSubscriberTracks).toBe(450);
        expect(shards[1].phases[0].beacon.expectedSubscriberTracks).toBe(75);
        expect(shards[0].phases[0].stage.args).toContain('hbload-event-weekend-s0-stage');
        expect(shards[1].phases[0].stage.args).toContain('hbload-event-weekend-s1-stage');
        expect(shards[0].phases.map((phase) => phase.scheduledOffsetSeconds)).toEqual([
            0, 91, 1322, 1413,
        ]);
    });

    it('partitions uneven totals deterministically without dropping work', () => {
        expect([0, 1, 2].map((index) => partitionCount(10, index, 3))).toEqual([4, 3, 3]);
        expect([0, 1, 2].map((index) => partitionCount(2, index, 3))).toEqual([1, 1, 0]);
    });

    it('accounts for the LiveKit CLI connection ramp before its duration timer', () => {
        expect(connectionRampSeconds(78, 5)).toBe(16);
        expect(connectionRampSeconds(6, 6)).toBe(1);
        expect(connectionRampSeconds(151, 100)).toBe(15);
    });

    it('fails closed on incomplete or unsynchronized shard coordinates', () => {
        expect(() => validateShard({ shardIndex: 2, shardCount: 2 }, profile))
            .toThrow(/shardIndex/);
        expect(() => validateShard({ shardIndex: 0, shardCount: 11 }, profile))
            .toThrow(/ramp rate/);
        expect(() => buildPlan({
            profileName: 'rehearsal-es',
            profile,
            runId: 'event-weekend',
            url: 'ws://localhost:7880',
            shardIndex: 0,
            shardCount: 2,
        })).toThrow(/shared startAt/);
    });

    it('accepts only explicit UTC scheduled starts', () => {
        expect(normalizeScheduledStart('2026-08-06T12:00:00Z'))
            .toBe('2026-08-06T12:00:00.000Z');
        expect(() => normalizeScheduledStart('2026-08-06T12:00:00-03:00'))
            .toThrow(/UTC/);
        expect(() => normalizeScheduledStart('not-a-date')).toThrow(/UTC/);
    });

    it('rejects a seventh stage publisher before starting traffic', () => {
        expect(() => validateProfile({ ...profile, stagePublishers: 7 }))
            .toThrow(/cap of six/);
    });

    it('requires an explicit supported stage codec and layout', () => {
        expect(() => validateProfile({ ...profile, stageVideoCodec: 'mixed' }))
            .toThrow(/stageVideoCodec/);
        expect(() => validateProfile({ ...profile, stageLayout: 'gallery' }))
            .toThrow(/stageLayout/);
    });

    it('refuses remote targets unless the operator confirms both generated test rooms exactly', () => {
        const rooms = roomNames('remote-check');
        expect(() => assertSafeTarget({
            url: 'wss://live.example.test', rooms, allowRemote: false, confirmation: '',
        })).toThrow(/require --allow-remote/);
        expect(() => assertSafeTarget({
            url: 'wss://live.example.test', rooms, allowRemote: true, confirmation: 'yes',
        })).toThrow(/confirmation mismatch/);
        expect(assertSafeTarget({
            url: 'wss://live.example.test',
            rooms,
            allowRemote: true,
            confirmation: remoteConfirmation(rooms),
        }).target).toBe('remote-explicit');
    });

    it('never accepts real event room names', () => {
        expect(() => assertSafeTarget({
            url: 'ws://localhost:7880',
            rooms: { stage: 'real-spanish-event', beacon: 'beacon' },
            allowRemote: false,
            confirmation: '',
        })).toThrow(/unsafe room name/);
    });
});

describe('LiveKit load harness evidence', () => {
    it('distinguishes separate VM boots while keeping same-kernel processes identical', () => {
        const first = generatorHostFingerprint({
            hostName: 'runner',
            machineId: 'cloned-image',
            bootId: 'boot-a',
        });
        expect(generatorHostFingerprint({
            hostName: 'runner',
            machineId: 'cloned-image',
            bootId: 'boot-a',
        })).toBe(first);
        expect(generatorHostFingerprint({
            hostName: 'runner',
            machineId: 'cloned-image',
            bootId: 'boot-b',
        })).not.toBe(first);
        expect(first).toMatch(/^[a-f0-9]{12}$/);
    });

    it('aggregates only exact, clean shard coverage from distinct generator hosts', () => {
        const startAt = '2026-08-06T12:00:00.000Z';
        const entries = [0, 1].map((shardIndex) => ({
            sha256: String(shardIndex).padStart(64, 'a'),
            manifest: passingShardManifest(buildPlan({
                profileName: 'rehearsal-es',
                profile,
                runId: 'aggregate-test',
                url: 'ws://localhost:7880',
                shardIndex,
                shardCount: 2,
                startAt,
            }), shardIndex),
        }));

        const aggregate = aggregateShardManifests(entries);
        expect(aggregate).toMatchObject({
            kind: 'harmonic-beacon-livekit-load-aggregate',
            status: 'PASS',
            runId: 'aggregate-test',
            shardCount: 2,
            totals: { attendees: 150, stagePublishers: 6, beaconPublishers: 1 },
            sources: [
                { index: 0, generatorHostHash: '000000000000' },
                { index: 1, generatorHostHash: '000000000001' },
            ],
        });
        expect(aggregate.phases[0]).toMatchObject({
            name: 'ramp',
            shardsPassed: 2,
            startSkewMs: 0,
            apiErrors: 0,
            stage: {
                expectedConnections: 156,
                subscriberTracksExpected: 900,
                subscriberTracksReceived: 900,
            },
            beacon: {
                expectedConnections: 151,
                subscriberTracksExpected: 150,
                subscriberTracksReceived: 150,
            },
        });
    });

    it('refuses duplicate hosts, dirty evidence and unproven global observations', () => {
        const startAt = '2026-08-06T12:00:00.000Z';
        const entries = [0, 1].map((shardIndex) => ({
            sha256: String(shardIndex).padStart(64, 'a'),
            manifest: passingShardManifest(buildPlan({
                profileName: 'rehearsal-es',
                profile,
                runId: 'aggregate-refusal',
                url: 'ws://localhost:7880',
                shardIndex,
                shardCount: 2,
                startAt,
            }), shardIndex),
        }));

        entries[1].manifest.generatorHostHash = entries[0].manifest.generatorHostHash;
        expect(() => aggregateShardManifests(entries)).toThrow(/distinct hosts/);
        entries[1].manifest.generatorHostHash = '000000000001';
        entries[1].manifest.harnessDirty = true;
        expect(() => aggregateShardManifests(entries)).toThrow(/dirty harness/);
        entries[1].manifest.harnessDirty = false;
        entries[1].manifest.phases[0].observed.stage.peakConnections -= 1;
        expect(() => aggregateShardManifests(entries)).toThrow(/unproven phase/);
    });

    it('writes a 0600 aggregate once and refuses to overwrite it', () => {
        const root = mkdtempSync(join(tmpdir(), 'hb-load-aggregate-'));
        temporaryRoots.push(root);
        const startAt = '2026-08-06T12:00:00.000Z';
        const manifestPaths = [0, 1].map((shardIndex) => {
            const path = join(root, `shard-${shardIndex}.json`);
            writeFileSync(path, JSON.stringify(passingShardManifest(buildPlan({
                profileName: 'rehearsal-es',
                profile,
                runId: 'aggregate-cli',
                url: 'ws://localhost:7880',
                shardIndex,
                shardCount: 2,
                startAt,
            }), shardIndex)));
            return path;
        });
        const output = join(root, 'aggregate.json');
        const args = [
            'scripts/livekit-load-aggregate.mjs',
            '--output', output,
            ...manifestPaths,
        ];

        const first = spawnSync('node', args, { encoding: 'utf8', timeout: 5_000 });
        expect(first.status, first.stderr).toBe(0);
        expect(statSync(output).mode & 0o777).toBe(0o600);
        expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
            status: 'PASS',
            shardCount: 2,
        });
        const before = readFileSync(output, 'utf8');
        const second = spawnSync('node', args, { encoding: 'utf8', timeout: 5_000 });
        expect(second.status).toBe(1);
        expect(second.stderr).toMatch(/refusing to overwrite/);
        expect(readFileSync(output, 'utf8')).toBe(before);
    });

    it('parses the official CLI total summary without retaining participant rows', () => {
        const output = 'Summary | Tester | Tracks | Bitrate | Latency | Total Dropped\n' +
            '        | Total | 5000/5000 | 678.7mbps | 79.923769ms | 0 (0%)\n';
        expect(parseLoadTestOutput(output)).toEqual({
            parsed: true,
            tracksReceived: 5000,
            tracksExpected: 5000,
            latencyMs: 79.923769,
            dropped: 0,
            droppedPercent: 0,
            errorCount: null,
        });
    });

    it('parses the current Unicode CLI table and its error count', () => {
        const output = '│ Total  │ 8/8 │ 6.3mbps (1.6mbps avg) │ 0 (0%) │ 0 │';
        expect(parseLoadTestOutput(output)).toEqual({
            parsed: true,
            tracksReceived: 8,
            tracksExpected: 8,
            latencyMs: null,
            dropped: 0,
            droppedPercent: 0,
            errorCount: 0,
        });
    });

    it('fails closed when the CLI output has no machine-recognizable summary', () => {
        expect(parseLoadTestOutput('load tester exited unexpectedly').parsed).toBe(false);
    });

    it('detects credentials anywhere in a candidate manifest', () => {
        expect(manifestContainsSecret({ nested: ['safe', 'secret-value'] }, ['key', 'secret-value']))
            .toBe(true);
        expect(manifestContainsSecret({ nested: ['safe'] }, ['key', 'secret-value']))
            .toBe(false);
    });

    it('coordinates the first operator abort across current and late child processes', () => {
        const terminated: string[] = [];
        const abort = createAbortCoordinator({
            terminate: (child: { name: string }) => terminated.push(child.name),
        });
        const untrackStage = abort.track({ name: 'stage', killed: false });
        abort.track({ name: 'beacon', killed: false });

        expect(abort.request('SIGINT')).toBe(true);
        expect(abort.request('SIGTERM')).toBe(false);
        abort.track({ name: 'late', killed: false });
        untrackStage();

        expect(terminated).toEqual(['stage', 'beacon', 'late']);
        expect(abort.requested).toBe(true);
        expect(abort.snapshot()).toMatchObject({ signal: 'SIGINT' });
        expect(abort.exitCode()).toBe(130);
    });

    it('maps SIGTERM to a non-zero result without inventing an abort beforehand', () => {
        const abort = createAbortCoordinator();
        expect(abort.requested).toBe(false);
        expect(abort.snapshot()).toBeNull();
        expect(abort.exitCode()).toBe(1);
        expect(abort.request('SIGTERM')).toBe(true);
        expect(abort.exitCode()).toBe(143);
    });
});
