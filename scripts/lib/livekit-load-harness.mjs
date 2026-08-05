import { createHash } from 'node:crypto';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ROOM_PATTERN = /^hb-load-[a-z0-9][a-z0-9-]{2,47}-(stage|beacon)$/;
export const PRODUCTION_READINESS_URL =
    'https://live.harmonicbeacon.com/api/health/ready';

export async function probeProductionReadiness({
    fetchImpl = fetch,
    timeoutMs = 2_500,
} = {}) {
    try {
        const response = await fetchImpl(PRODUCTION_READINESS_URL, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
        });
        const healthy = response.status === 200;
        await response.body?.cancel();
        return healthy;
    } catch {
        return false;
    }
}

export function createConsecutiveFailureGuard({ maxFailures = 2, onTrip }) {
    if (!Number.isInteger(maxFailures) || maxFailures < 1) {
        throw new Error('maxFailures must be a positive integer');
    }
    let failures = 0;
    let tripped = false;
    return {
        record(healthy) {
            if (tripped) return true;
            failures = healthy ? 0 : failures + 1;
            if (failures >= maxFailures) {
                tripped = true;
                onTrip();
            }
            return tripped;
        },
        get failures() {
            return failures;
        },
        get tripped() {
            return tripped;
        },
    };
}

export function sanitizeRunId(value) {
    const runId = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    if (runId.length < 3) {
        throw new Error('run id must contain at least three safe characters');
    }
    return runId;
}

export function validateProfile(profile) {
    const integerFields = [
        'attendees',
        'stagePublishers',
        'beaconPublishers',
        'rampPerSecond',
        'rampDurationSeconds',
        'soakDurationSeconds',
        'reconnectDurationSeconds',
        'reconnectWaves',
        'interWaveSeconds',
        'phaseCompletionBufferSeconds',
    ];
    for (const field of integerFields) {
        if (!Number.isInteger(profile[field]) || profile[field] < 0) {
            throw new Error(`${field} must be a non-negative integer`);
        }
    }
    if (profile.attendees < 1) throw new Error('attendees must be at least one');
    if (profile.stagePublishers > 6) {
        throw new Error('stagePublishers exceeds the product cap of six');
    }
    if (profile.beaconPublishers !== 1) {
        throw new Error('beaconPublishers must be exactly one');
    }
    if (profile.rampPerSecond < 1) throw new Error('rampPerSecond must be at least one');
    if (!['es', 'en'].includes(profile.eventLanguage)) {
        throw new Error('eventLanguage must be es or en');
    }
    if (!['simultaneous', 'staggered'].includes(profile.reconnectMode)) {
        throw new Error('reconnectMode must be simultaneous or staggered');
    }
    if (!['vp8', 'h264'].includes(profile.stageVideoCodec)) {
        throw new Error('stageVideoCodec must be vp8 or h264');
    }
    if (!['speaker', '3x3', '4x4', '5x5'].includes(profile.stageLayout)) {
        throw new Error('stageLayout must be speaker, 3x3, 4x4, or 5x5');
    }
    if (typeof profile.maxDroppedPercent !== 'number' ||
        profile.maxDroppedPercent < 0 || profile.maxDroppedPercent > 100) {
        throw new Error('maxDroppedPercent must be between zero and 100');
    }
    return profile;
}

export function validateShard({ shardIndex, shardCount }, profile) {
    if (!Number.isInteger(shardCount) || shardCount < 1) {
        throw new Error('shardCount must be a positive integer');
    }
    if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
        throw new Error('shardIndex must be an integer between zero and shardCount - 1');
    }
    if (shardCount > profile.attendees) {
        throw new Error('shardCount cannot exceed attendee count');
    }
    if (shardCount > profile.rampPerSecond) {
        throw new Error('shardCount cannot exceed the global ramp rate');
    }
    return { shardIndex, shardCount };
}

export function partitionCount(total, shardIndex, shardCount) {
    const base = Math.floor(total / shardCount);
    return base + (shardIndex < total % shardCount ? 1 : 0);
}

function shardExpectedConnectSeconds(profile, shardIndex, shardCount, phaseName) {
    const attendees = partitionCount(profile.attendees, shardIndex, shardCount);
    const stagePublishers = partitionCount(profile.stagePublishers, shardIndex, shardCount);
    const beaconPublishers = partitionCount(profile.beaconPublishers, shardIndex, shardCount);
    const rampPerSecond = partitionCount(profile.rampPerSecond, shardIndex, shardCount);
    const simultaneousReconnect = phaseName.startsWith('reconnect-') &&
        profile.reconnectMode === 'simultaneous';
    const stageRampPerSecond = simultaneousReconnect
        ? attendees + stagePublishers
        : rampPerSecond;
    const beaconRampPerSecond = simultaneousReconnect
        ? attendees + beaconPublishers
        : rampPerSecond;
    return Math.max(
        connectionRampSeconds(attendees + stagePublishers, stageRampPerSecond),
        connectionRampSeconds(attendees + beaconPublishers, beaconRampPerSecond),
    );
}

function distributedExpectedConnectSeconds(profile, shardCount, phaseName) {
    return Math.max(...Array.from(
        { length: shardCount },
        (_, shardIndex) => shardExpectedConnectSeconds(
            profile,
            shardIndex,
            shardCount,
            phaseName,
        ),
    ));
}

function streamExpectedConnectSeconds(connections, rampPerSecond) {
    return connectionRampSeconds(connections, rampPerSecond);
}

export function connectionRampSeconds(connections, rampPerSecond) {
    if (connections <= 1) return 0;
    return Math.ceil((connections - 1) / Math.min(rampPerSecond, 10));
}

export function normalizeScheduledStart(value) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)) {
        throw new Error('startAt must be an explicit UTC timestamp ending in Z');
    }
    const milliseconds = Date.parse(text);
    if (!Number.isFinite(milliseconds)) throw new Error('startAt is not a valid timestamp');
    return new Date(milliseconds).toISOString();
}

export function scheduledCompletionDelayMs(startAt, phase, nowMs = Date.now()) {
    if (startAt === null) return 0;
    return Math.max(0,
        Date.parse(startAt) +
        (phase.scheduledOffsetSeconds + phase.expectedConnectSeconds + phase.durationSeconds) * 1000 -
        nowMs,
    );
}

export function roomNames(runId) {
    const safeRunId = sanitizeRunId(runId);
    return {
        stage: `hb-load-${safeRunId}-stage`,
        beacon: `hb-load-${safeRunId}-beacon`,
    };
}

export function remoteConfirmation(rooms) {
    return `LOADTEST:${rooms.stage}:${rooms.beacon}`;
}

export function validateDistributedTargetUrl(value) {
    let parsed;
    try {
        parsed = new URL(String(value ?? ''));
    } catch {
        throw new Error('distributed target URL must be a valid ws:// or wss:// URL');
    }
    if (!['ws:', 'wss:'].includes(parsed.protocol)) {
        throw new Error('distributed target URL must use ws:// or wss://');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('distributed target URL must not contain credentials, query, or fragment');
    }
    if (LOCAL_HOSTS.has(parsed.hostname)) {
        throw new Error('distributed target URL must be remote');
    }
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
        throw new Error('distributed target URL must not contain a path');
    }
    return parsed.toString().replace(/\/$/, '');
}

export function assertSafeTarget({ url, rooms, allowRemote, confirmation }) {
    const parsed = new URL(url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'));
    for (const room of Object.values(rooms)) {
        if (!ROOM_PATTERN.test(room)) {
            throw new Error(`unsafe room name: ${room}`);
        }
    }
    if (LOCAL_HOSTS.has(parsed.hostname)) return { target: 'local', host: parsed.hostname };
    if (!allowRemote) {
        throw new Error(
            `remote LiveKit targets require --allow-remote and --confirm-test-rooms ${remoteConfirmation(rooms)}`,
        );
    }
    const expected = remoteConfirmation(rooms);
    if (confirmation !== expected) {
        throw new Error(`remote confirmation mismatch; expected ${expected}`);
    }
    return { target: 'remote-explicit', host: parsed.hostname };
}

function commandFor({
    room,
    identityPrefix,
    durationSeconds,
    publishers,
    publisherKind,
    attendees,
    rampPerSecond,
    videoCodec,
    layout,
}) {
    const args = [
        'load-test',
        '--room', room,
        '--identity-prefix', identityPrefix,
        '--duration', `${durationSeconds}s`,
        '--subscribers', String(attendees),
        '--num-per-second', String(rampPerSecond),
    ];
    args.push(
        publisherKind === 'video' ? '--video-publishers' : '--audio-publishers',
        String(publishers),
    );
    if (publisherKind === 'video') {
        args.push(
            '--video-resolution', 'high',
            '--video-codec', videoCodec,
            '--layout', layout,
        );
    }
    return args;
}

export function buildPlan({
    profileName,
    profile,
    runId,
    url,
    allowRemote = false,
    confirmation = '',
    shardIndex = 0,
    shardCount = 1,
    startAt = /** @type {string | null | undefined} */ (undefined),
}) {
    validateProfile(profile);
    validateShard({ shardIndex, shardCount }, profile);
    const scheduledStartAt = normalizeScheduledStart(startAt);
    if (shardCount > 1 && scheduledStartAt === null) {
        throw new Error('sharded runs require a shared startAt timestamp');
    }
    const rooms = roomNames(`${sanitizeRunId(runId)}-${profile.eventLanguage}`);
    const safety = assertSafeTarget({ url, rooms, allowRemote, confirmation });
    const localAttendees = partitionCount(profile.attendees, shardIndex, shardCount);
    const localStagePublishers = partitionCount(
        profile.stagePublishers,
        shardIndex,
        shardCount,
    );
    const localBeaconPublishers = partitionCount(
        profile.beaconPublishers,
        shardIndex,
        shardCount,
    );
    const localRampPerSecond = partitionCount(
        profile.rampPerSecond,
        shardIndex,
        shardCount,
    );
    const shardIdentity = shardCount === 1 ? '' : `-s${shardIndex}`;
    const phaseGapSeconds = shardCount === 1
        ? profile.interWaveSeconds
        : Math.max(profile.interWaveSeconds, 15);
    const phases = [
        {
            name: 'ramp',
            durationSeconds: profile.rampDurationSeconds,
            stageRampPerSecond: localRampPerSecond,
            beaconRampPerSecond: localRampPerSecond,
        },
        {
            name: 'soak',
            durationSeconds: profile.soakDurationSeconds,
            stageRampPerSecond: localRampPerSecond,
            beaconRampPerSecond: localRampPerSecond,
        },
    ];
    for (let wave = 1; wave <= profile.reconnectWaves; wave += 1) {
        phases.push({
            name: `reconnect-${wave}`,
            durationSeconds: profile.reconnectDurationSeconds,
            stageRampPerSecond: profile.reconnectMode === 'simultaneous'
                ? localAttendees + localStagePublishers
                : localRampPerSecond,
            beaconRampPerSecond: profile.reconnectMode === 'simultaneous'
                ? localAttendees + localBeaconPublishers
                : localRampPerSecond,
        });
    }
    let scheduledOffsetSeconds = 0;
    const scheduledPhases = phases.map((phase, index) => {
        const expectedConnectSeconds = shardCount === 1
            ? shardExpectedConnectSeconds(profile, shardIndex, shardCount, phase.name)
            : distributedExpectedConnectSeconds(profile, shardCount, phase.name);
        const stageExpectedConnectSeconds = streamExpectedConnectSeconds(
            localAttendees + localStagePublishers,
            phase.stageRampPerSecond,
        );
        const beaconExpectedConnectSeconds = streamExpectedConnectSeconds(
            localAttendees + localBeaconPublishers,
            phase.beaconRampPerSecond,
        );
        const scheduled = {
            ...phase,
            scheduledOffsetSeconds,
            expectedConnectSeconds,
            stageExpectedConnectSeconds,
            beaconExpectedConnectSeconds,
        };
        scheduledOffsetSeconds += expectedConnectSeconds + phase.durationSeconds;
        if (index < phases.length - 1) {
            scheduledOffsetSeconds += profile.phaseCompletionBufferSeconds + phaseGapSeconds;
        }
        return scheduled;
    });
    return {
        schemaVersion: 1,
        profileName,
        profile: structuredClone(profile),
        runId: sanitizeRunId(runId),
        urlHost: safety.host,
        target: safety.target,
        rooms,
        scheduledStartAt,
        shard: {
            index: shardIndex,
            count: shardCount,
            localAttendees,
            localStagePublishers,
            localBeaconPublishers,
            localRampPerSecond,
            phaseGapSeconds,
            phaseCompletionBufferSeconds: profile.phaseCompletionBufferSeconds,
        },
        phases: scheduledPhases.map((phase) => ({
            ...phase,
            stage: {
                roomName: rooms.stage,
                requestedConnections: localAttendees + localStagePublishers,
                expectedGlobalConnections: profile.attendees + profile.stagePublishers,
                localPublishers: localStagePublishers,
                expectedGlobalPublishers: profile.stagePublishers,
                expectedSubscriberTracks: localAttendees * profile.stagePublishers,
                localExpectedConnectSeconds: phase.stageExpectedConnectSeconds,
                commandDurationSeconds: phase.durationSeconds +
                    phase.expectedConnectSeconds - phase.stageExpectedConnectSeconds,
                args: commandFor({
                    room: rooms.stage,
                    identityPrefix: `hbload-${sanitizeRunId(runId)}${shardIdentity}-stage`,
                    durationSeconds: phase.durationSeconds +
                        phase.expectedConnectSeconds - phase.stageExpectedConnectSeconds,
                    publishers: localStagePublishers,
                    publisherKind: 'video',
                    attendees: localAttendees,
                    rampPerSecond: phase.stageRampPerSecond,
                    videoCodec: profile.stageVideoCodec,
                    layout: profile.stageLayout,
                }),
            },
            beacon: {
                roomName: rooms.beacon,
                requestedConnections: localAttendees + localBeaconPublishers,
                expectedGlobalConnections: profile.attendees + profile.beaconPublishers,
                localPublishers: localBeaconPublishers,
                expectedGlobalPublishers: profile.beaconPublishers,
                expectedSubscriberTracks: localAttendees * profile.beaconPublishers,
                localExpectedConnectSeconds: phase.beaconExpectedConnectSeconds,
                commandDurationSeconds: phase.durationSeconds +
                    phase.expectedConnectSeconds - phase.beaconExpectedConnectSeconds,
                args: commandFor({
                    room: rooms.beacon,
                    identityPrefix: `hbload-${sanitizeRunId(runId)}${shardIdentity}-beacon`,
                    durationSeconds: phase.durationSeconds +
                        phase.expectedConnectSeconds - phase.beaconExpectedConnectSeconds,
                    publishers: localBeaconPublishers,
                    publisherKind: 'audio',
                    attendees: localAttendees,
                    rampPerSecond: phase.beaconRampPerSecond,
                }),
            },
        })),
    };
}

export function buildDistributedDispatchPlan({
    profileName,
    profile,
    runId,
    targetUrl,
    startDelaySeconds,
    shardCount = 2,
    nowMs = Date.now(),
}) {
    const url = validateDistributedTargetUrl(targetUrl);
    if (!Number.isInteger(startDelaySeconds) ||
        startDelaySeconds < 600 || startDelaySeconds > 3600) {
        throw new Error('start delay must be an integer between 600 and 3600 seconds');
    }
    if (![2, 6].includes(shardCount)) {
        throw new Error('the GitHub-hosted rehearsal requires two or six shards');
    }
    const safeRunId = sanitizeRunId(runId);
    const startAt = new Date(nowMs + startDelaySeconds * 1000).toISOString();
    const rooms = roomNames(`${safeRunId}-${profile.eventLanguage}`);
    const confirmation = remoteConfirmation(rooms);
    const plans = Array.from({ length: shardCount }, (_, shardIndex) => buildPlan({
        profileName,
        profile,
        runId: safeRunId,
        url,
        allowRemote: true,
        confirmation,
        shardIndex,
        shardCount,
        startAt,
    }));
    const finalPhase = plans[0].phases.at(-1);
    const expectedEndAt = new Date(
        Date.parse(startAt) +
        (finalPhase.scheduledOffsetSeconds +
            finalPhase.expectedConnectSeconds +
            finalPhase.durationSeconds) * 1000,
    ).toISOString();
    return {
        profileName,
        runId: safeRunId,
        shardCount,
        startAt,
        expectedEndAt,
        confirmation,
        rooms,
        targetHost: plans[0].urlHost,
    };
}

function stripAnsi(value) {
    return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

export function parseLoadTestOutput(output) {
    const lines = stripAnsi(output).split(/\r?\n/).filter(Boolean);
    const totalLine = [...lines].reverse().find((line) => /[|│]\s*Total\s*[|│]/.test(line));
    if (!totalLine) {
        return { parsed: false, tracksReceived: null, tracksExpected: null, latencyMs: null, dropped: null, droppedPercent: null, errorCount: null };
    }
    const columns = totalLine.split(/[|│]/).map((column) => column.trim()).filter(Boolean);
    const tracks = columns.find((column) => /^\d+\/\d+$/.test(column));
    const latency = columns.find((column) => /^\d+(?:\.\d+)?(?:µs|ms|s)$/.test(column));
    const dropped = columns.find((column) => /^\d+\s+\(\d+(?:\.\d+)?%\)$/.test(column));
    const trackMatch = tracks?.match(/^(\d+)\/(\d+)$/);
    const latencyMatch = latency?.match(/^(\d+(?:\.\d+)?)(µs|ms|s)$/);
    const droppedMatch = dropped?.match(/^(\d+)\s+\((\d+(?:\.\d+)?)%\)$/);
    const errorColumn = [...columns].reverse().find((column) => /^\d+$/.test(column));
    const latencyFactor = latencyMatch?.[2] === 's' ? 1000 : latencyMatch?.[2] === 'µs' ? 0.001 : 1;
    return {
        parsed: Boolean(trackMatch && droppedMatch),
        tracksReceived: trackMatch ? Number(trackMatch[1]) : null,
        tracksExpected: trackMatch ? Number(trackMatch[2]) : null,
        latencyMs: latencyMatch ? Number(latencyMatch[1]) * latencyFactor : null,
        dropped: droppedMatch ? Number(droppedMatch[1]) : null,
        droppedPercent: droppedMatch ? Number(droppedMatch[2]) : null,
        errorCount: errorColumn ? Number(errorColumn) : null,
    };
}

export function commandFingerprint(args) {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

export function publicLoadPlan(plan, executable = 'lk') {
    return {
        ...plan,
        phases: plan.phases.map((phase) => ({
            ...phase,
            stage: {
                roomName: phase.stage.roomName,
                requestedConnections: phase.stage.requestedConnections,
                expectedGlobalConnections: phase.stage.expectedGlobalConnections,
                localPublishers: phase.stage.localPublishers,
                expectedGlobalPublishers: phase.stage.expectedGlobalPublishers,
                expectedSubscriberTracks: phase.stage.expectedSubscriberTracks,
                localExpectedConnectSeconds: phase.stage.localExpectedConnectSeconds,
                commandDurationSeconds: phase.stage.commandDurationSeconds,
                command: `${executable} ${phase.stage.args.join(' ')}`,
                fingerprint: commandFingerprint(phase.stage.args),
            },
            beacon: {
                roomName: phase.beacon.roomName,
                requestedConnections: phase.beacon.requestedConnections,
                expectedGlobalConnections: phase.beacon.expectedGlobalConnections,
                localPublishers: phase.beacon.localPublishers,
                expectedGlobalPublishers: phase.beacon.expectedGlobalPublishers,
                expectedSubscriberTracks: phase.beacon.expectedSubscriberTracks,
                localExpectedConnectSeconds: phase.beacon.localExpectedConnectSeconds,
                commandDurationSeconds: phase.beacon.commandDurationSeconds,
                command: `${executable} ${phase.beacon.args.join(' ')}`,
                fingerprint: commandFingerprint(phase.beacon.args),
            },
        })),
    };
}

export function generatorHostFingerprint({ hostName, machineId = '', bootId = '' }) {
    return commandFingerprint([hostName, machineId, bootId]).slice(0, 12);
}

export function manifestContainsSecret(value, secrets) {
    const serialized = JSON.stringify(value);
    return secrets.filter(Boolean).some((secret) => serialized.includes(secret));
}

function sameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function assertAggregate(condition, message) {
    if (!condition) throw new Error(`shard aggregate refused: ${message}`);
}

function phasePassedIndependently(phase, plannedPhase, profile) {
    const streams = ['stage', 'beacon'];
    if (
        !phase.passed ||
        phase.operatorAborted ||
        !phase.synchronization?.passed ||
        !phase.cleanup?.passed
    ) return false;
    if (phase.observed?.apiErrors !== 0 || phase.observed?.successfulSamples < 1) return false;
    const scheduledFor = phase.synchronization.scheduledFor;
    for (const stream of streams) {
        const result = phase[stream];
        const observed = phase.observed?.[stream];
        const planned = plannedPhase[stream];
        if (
            result?.exitCode !== 0 ||
            (scheduledFor !== null && (
                !Number.isFinite(Date.parse(result?.startedAt)) ||
                Math.abs(Date.parse(result.startedAt) - Date.parse(scheduledFor)) > 5_000
            )) ||
            !result.summary?.parsed ||
            result.summary.tracksReceived !== planned.expectedSubscriberTracks ||
            result.summary.droppedPercent > profile.maxDroppedPercent ||
            (result.summary.errorCount !== null && result.summary.errorCount !== 0) ||
            observed?.expectedConnections !== planned.expectedGlobalConnections ||
            observed?.peakConnections !== planned.expectedGlobalConnections ||
            observed?.joinObserved !== planned.expectedGlobalConnections ||
            observed?.expectedPublishers !== planned.expectedGlobalPublishers ||
            observed?.peakPublishers !== planned.expectedGlobalPublishers
        ) return false;
    }
    return true;
}

function shardPlanIsDeterministic(plan, index, shardCount) {
    const profile = plan.profile;
    const localAttendees = partitionCount(profile.attendees, index, shardCount);
    const localStagePublishers = partitionCount(profile.stagePublishers, index, shardCount);
    const localBeaconPublishers = partitionCount(profile.beaconPublishers, index, shardCount);
    const localRampPerSecond = partitionCount(profile.rampPerSecond, index, shardCount);
    const expectedGap = Math.max(profile.interWaveSeconds, 15);
    if (
        plan.shard.localAttendees !== localAttendees ||
        plan.shard.localStagePublishers !== localStagePublishers ||
        plan.shard.localBeaconPublishers !== localBeaconPublishers ||
        plan.shard.localRampPerSecond !== localRampPerSecond ||
        plan.shard.phaseGapSeconds !== expectedGap ||
        plan.shard.phaseCompletionBufferSeconds !== profile.phaseCompletionBufferSeconds
    ) return false;

    let offset = 0;
    return plan.phases.every((phase, phaseIndex) => {
        const stageRamp = phaseIndex >= 2 && profile.reconnectMode === 'simultaneous'
            ? localAttendees + localStagePublishers
            : localRampPerSecond;
        const beaconRamp = phaseIndex >= 2 && profile.reconnectMode === 'simultaneous'
            ? localAttendees + localBeaconPublishers
            : localRampPerSecond;
        const expectedConnectSeconds = distributedExpectedConnectSeconds(
            profile,
            shardCount,
            phase.name,
        );
        const stageExpectedConnectSeconds = streamExpectedConnectSeconds(
            localAttendees + localStagePublishers,
            stageRamp,
        );
        const beaconExpectedConnectSeconds = streamExpectedConnectSeconds(
            localAttendees + localBeaconPublishers,
            beaconRamp,
        );
        const stageCommandDurationSeconds = phase.durationSeconds +
            expectedConnectSeconds - stageExpectedConnectSeconds;
        const beaconCommandDurationSeconds = phase.durationSeconds +
            expectedConnectSeconds - beaconExpectedConnectSeconds;
        const valid =
            phase.scheduledOffsetSeconds === offset &&
            phase.expectedConnectSeconds === expectedConnectSeconds &&
            phase.stageExpectedConnectSeconds === stageExpectedConnectSeconds &&
            phase.beaconExpectedConnectSeconds === beaconExpectedConnectSeconds &&
            phase.stageRampPerSecond === stageRamp &&
            phase.beaconRampPerSecond === beaconRamp &&
            phase.stage.roomName === plan.rooms.stage &&
            phase.stage.requestedConnections === localAttendees + localStagePublishers &&
            phase.stage.expectedGlobalConnections === profile.attendees + profile.stagePublishers &&
            phase.stage.localPublishers === localStagePublishers &&
            phase.stage.expectedGlobalPublishers === profile.stagePublishers &&
            phase.stage.expectedSubscriberTracks === localAttendees * profile.stagePublishers &&
            phase.stage.localExpectedConnectSeconds === stageExpectedConnectSeconds &&
            phase.stage.commandDurationSeconds === stageCommandDurationSeconds &&
            phase.stage.fingerprint === commandFingerprint(commandFor({
                room: plan.rooms.stage,
                identityPrefix: `hbload-${sanitizeRunId(plan.runId)}-s${index}-stage`,
                durationSeconds: stageCommandDurationSeconds,
                publishers: localStagePublishers,
                publisherKind: 'video',
                attendees: localAttendees,
                rampPerSecond: stageRamp,
                videoCodec: profile.stageVideoCodec,
                layout: profile.stageLayout,
            })) &&
            phase.beacon.roomName === plan.rooms.beacon &&
            phase.beacon.requestedConnections === localAttendees + localBeaconPublishers &&
            phase.beacon.expectedGlobalConnections === profile.attendees + profile.beaconPublishers &&
            phase.beacon.localPublishers === localBeaconPublishers &&
            phase.beacon.expectedGlobalPublishers === profile.beaconPublishers &&
            phase.beacon.expectedSubscriberTracks === localAttendees * profile.beaconPublishers &&
            phase.beacon.localExpectedConnectSeconds === beaconExpectedConnectSeconds &&
            phase.beacon.commandDurationSeconds === beaconCommandDurationSeconds &&
            phase.beacon.fingerprint === commandFingerprint(commandFor({
                room: plan.rooms.beacon,
                identityPrefix: `hbload-${sanitizeRunId(plan.runId)}-s${index}-beacon`,
                durationSeconds: beaconCommandDurationSeconds,
                publishers: localBeaconPublishers,
                publisherKind: 'audio',
                attendees: localAttendees,
                rampPerSecond: beaconRamp,
            }));
        offset += expectedConnectSeconds + phase.durationSeconds;
        if (phaseIndex < plan.phases.length - 1) {
            offset += profile.phaseCompletionBufferSeconds + expectedGap;
        }
        return valid;
    });
}

export function aggregateShardManifests(entries) {
    assertAggregate(Array.isArray(entries) && entries.length >= 2, 'at least two shards are required');
    const first = entries[0]?.manifest;
    const shardCount = first?.plan?.shard?.count;
    assertAggregate(Number.isInteger(shardCount) && shardCount >= 2, 'invalid shard count');
    assertAggregate(entries.length === shardCount, 'manifest count does not match shard count');

    const expectedCore = {
        schemaVersion: first.schemaVersion,
        kind: first.kind,
        harnessSha: first.harnessSha,
        livekitCliVersion: first.livekitCliVersion,
        profileName: first.plan.profileName,
        profile: first.plan.profile,
        runId: first.plan.runId,
        rooms: first.plan.rooms,
        scheduledStartAt: first.plan.scheduledStartAt,
        target: first.plan.target,
        urlHost: first.plan.urlHost,
        phaseNames: first.plan.phases.map((phase) => phase.name),
        phaseOffsets: first.plan.phases.map((phase) => phase.scheduledOffsetSeconds),
    };
    assertAggregate(first.schemaVersion === 1, 'unexpected manifest schema');
    assertAggregate(first.kind === 'harmonic-beacon-livekit-load', 'unexpected manifest kind');
    assertAggregate(/^[a-f0-9]{40}$/.test(first.harnessSha), 'invalid harness SHA');
    assertAggregate(first.plan.scheduledStartAt !== null, 'shared start timestamp is missing');
    try {
        validateProfile(first.plan.profile);
        validateShard({ shardIndex: first.plan.shard.index, shardCount }, first.plan.profile);
    } catch {
        assertAggregate(false, 'invalid profile or shard contract');
    }

    const indices = new Set();
    const hosts = new Set();
    const sourceHashes = new Set();
    let attendeeTotal = 0;
    let stagePublisherTotal = 0;
    let beaconPublisherTotal = 0;
    const sources = [];

    for (const entry of entries) {
        const manifest = entry.manifest;
        const core = {
            schemaVersion: manifest.schemaVersion,
            kind: manifest.kind,
            harnessSha: manifest.harnessSha,
            livekitCliVersion: manifest.livekitCliVersion,
            profileName: manifest.plan?.profileName,
            profile: manifest.plan?.profile,
            runId: manifest.plan?.runId,
            rooms: manifest.plan?.rooms,
            scheduledStartAt: manifest.plan?.scheduledStartAt,
            target: manifest.plan?.target,
            urlHost: manifest.plan?.urlHost,
            phaseNames: manifest.plan?.phases?.map((phase) => phase.name),
            phaseOffsets: manifest.plan?.phases?.map((phase) => phase.scheduledOffsetSeconds),
        };
        assertAggregate(sameJson(core, expectedCore), 'shards do not describe the same run');
        assertAggregate(manifest.status === 'PASS', 'every shard must have status PASS');
        assertAggregate(manifest.harnessDirty === false, 'dirty harness evidence is not admissible');
        assertAggregate(manifest.plan.shard.count === shardCount, 'inconsistent shard count');
        const index = manifest.plan.shard.index;
        assertAggregate(Number.isInteger(index) && index >= 0 && index < shardCount, 'invalid shard index');
        assertAggregate(!indices.has(index), 'duplicate shard index');
        indices.add(index);
        assertAggregate(
            typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256),
            'invalid source manifest hash',
        );
        assertAggregate(!sourceHashes.has(entry.sha256), 'duplicate source manifest');
        sourceHashes.add(entry.sha256);
        assertAggregate(
            typeof manifest.generatorHostHash === 'string' &&
            /^[a-f0-9]{12}$/.test(manifest.generatorHostHash),
            'invalid generator host hash',
        );
        assertAggregate(!hosts.has(manifest.generatorHostHash), 'shards must run on distinct hosts');
        hosts.add(manifest.generatorHostHash);
        assertAggregate(
            shardPlanIsDeterministic(manifest.plan, index, shardCount),
            `shard ${index} is not the deterministic partition`,
        );
        assertAggregate(
            manifest.phases.length === manifest.plan.phases.length &&
            manifest.phases.every((phase, phaseIndex) => phasePassedIndependently(
                phase,
                manifest.plan.phases[phaseIndex],
                manifest.plan.profile,
            )),
            `shard ${index} contains an unproven phase`,
        );
        attendeeTotal += manifest.plan.shard.localAttendees;
        stagePublisherTotal += manifest.plan.shard.localStagePublishers;
        beaconPublisherTotal += manifest.plan.shard.localBeaconPublishers;
        sources.push({
            index,
            sha256: entry.sha256,
            generatorHostHash: manifest.generatorHostHash,
            status: manifest.status,
        });
    }

    assertAggregate(indices.size === shardCount, 'not every shard index is present');
    assertAggregate(attendeeTotal === first.plan.profile.attendees, 'attendee partition is incomplete');
    assertAggregate(
        stagePublisherTotal === first.plan.profile.stagePublishers,
        'stage publisher partition is incomplete',
    );
    assertAggregate(
        beaconPublisherTotal === first.plan.profile.beaconPublishers,
        'Beacon publisher partition is incomplete',
    );

    const phaseEvidence = first.plan.phases.map((plannedPhase, phaseIndex) => {
        const phases = entries.map((entry) => entry.manifest.phases[phaseIndex]);
        const startTimes = phases.flatMap((phase) => [
            Date.parse(phase.stage.startedAt),
            Date.parse(phase.beacon.startedAt),
        ]);
        const streamEvidence = (stream) => ({
            expectedConnections: plannedPhase[stream].expectedGlobalConnections,
            peakConnections: Math.max(...phases.map(
                (phase) => phase.observed[stream].peakConnections,
            )),
            expectedPublishers: plannedPhase[stream].expectedGlobalPublishers,
            peakPublishers: Math.max(...phases.map(
                (phase) => phase.observed[stream].peakPublishers,
            )),
            subscriberTracksExpected: entries.reduce(
                (total, entry) => total +
                    entry.manifest.plan.phases[phaseIndex][stream].expectedSubscriberTracks,
                0,
            ),
            subscriberTracksReceived: phases.reduce(
                (total, phase) => total + phase[stream].summary.tracksReceived,
                0,
            ),
            maxDroppedPercent: Math.max(...phases.map(
                (phase) => phase[stream].summary.droppedPercent,
            )),
        });
        const cleanupTimes = phases
            .map((phase) => phase.cleanup.convergenceMs)
            .filter(Number.isFinite);
        return {
            name: plannedPhase.name,
            shardsPassed: shardCount,
            startSkewMs: Math.max(...startTimes) - Math.min(...startTimes),
            apiErrors: phases.reduce((total, phase) => total + phase.observed.apiErrors, 0),
            cleanupMaxConvergenceMs: cleanupTimes.length > 0 ? Math.max(...cleanupTimes) : null,
            stage: streamEvidence('stage'),
            beacon: streamEvidence('beacon'),
        };
    });

    return {
        schemaVersion: 1,
        kind: 'harmonic-beacon-livekit-load-aggregate',
        status: 'PASS',
        generatedAt: new Date().toISOString(),
        harnessSha: first.harnessSha,
        livekitCliVersion: first.livekitCliVersion,
        runId: first.plan.runId,
        profileName: first.plan.profileName,
        rooms: first.plan.rooms,
        scheduledStartAt: first.plan.scheduledStartAt,
        shardCount,
        totals: {
            attendees: attendeeTotal,
            stagePublishers: stagePublisherTotal,
            beaconPublishers: beaconPublisherTotal,
        },
        phases: phaseEvidence,
        sources: sources.sort((left, right) => left.index - right.index),
    };
}

export function createAbortCoordinator({ terminate = (child) => child.kill('SIGTERM') } = {}) {
    const children = new Set();
    let signal = null;
    let requestedAt = null;

    const terminateChild = (child) => {
        try {
            if (!child.killed) terminate(child);
        } catch {
            // A child can converge between the signal and this loop. Its close
            // event still supplies the bounded completion path to the caller.
        }
    };

    return {
        get requested() {
            return signal !== null;
        },
        request(nextSignal) {
            if (signal !== null) return false;
            signal = nextSignal;
            requestedAt = new Date().toISOString();
            for (const child of children) terminateChild(child);
            return true;
        },
        track(child) {
            children.add(child);
            if (signal !== null) terminateChild(child);
            return () => children.delete(child);
        },
        snapshot() {
            return signal === null ? null : { signal, requestedAt };
        },
        exitCode() {
            if (signal === 'SIGINT') return 130;
            if (signal === 'SIGTERM') return 143;
            return 1;
        },
    };
}
