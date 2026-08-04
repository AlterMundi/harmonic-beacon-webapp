import { createHash } from 'node:crypto';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ROOM_PATTERN = /^hb-load-[a-z0-9][a-z0-9-]{2,47}-(stage|beacon)$/;

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

export function buildPlan({ profileName, profile, runId, url, allowRemote = false, confirmation = '' }) {
    validateProfile(profile);
    const rooms = roomNames(`${sanitizeRunId(runId)}-${profile.eventLanguage}`);
    const safety = assertSafeTarget({ url, rooms, allowRemote, confirmation });
    const phases = [
        { name: 'ramp', durationSeconds: profile.rampDurationSeconds, rampPerSecond: profile.rampPerSecond },
        { name: 'soak', durationSeconds: profile.soakDurationSeconds, rampPerSecond: profile.rampPerSecond },
    ];
    for (let wave = 1; wave <= profile.reconnectWaves; wave += 1) {
        phases.push({
            name: `reconnect-${wave}`,
            durationSeconds: profile.reconnectDurationSeconds,
            rampPerSecond: profile.reconnectMode === 'simultaneous'
                ? profile.attendees + profile.stagePublishers
                : profile.rampPerSecond,
        });
    }
    return {
        schemaVersion: 1,
        profileName,
        profile: structuredClone(profile),
        runId: sanitizeRunId(runId),
        urlHost: safety.host,
        target: safety.target,
        rooms,
        phases: phases.map((phase) => ({
            ...phase,
            stage: {
                roomName: rooms.stage,
                requestedConnections: profile.attendees + profile.stagePublishers,
                args: commandFor({
                    room: rooms.stage,
                    identityPrefix: `hbload-${sanitizeRunId(runId)}-stage`,
                    durationSeconds: phase.durationSeconds,
                    publishers: profile.stagePublishers,
                    publisherKind: 'video',
                    attendees: profile.attendees,
                    rampPerSecond: phase.rampPerSecond,
                    videoCodec: profile.stageVideoCodec,
                    layout: profile.stageLayout,
                }),
            },
            beacon: {
                roomName: rooms.beacon,
                requestedConnections: profile.attendees + profile.beaconPublishers,
                args: commandFor({
                    room: rooms.beacon,
                    identityPrefix: `hbload-${sanitizeRunId(runId)}-beacon`,
                    durationSeconds: phase.durationSeconds,
                    publishers: profile.beaconPublishers,
                    publisherKind: 'audio',
                    attendees: profile.attendees,
                    rampPerSecond: phase.rampPerSecond,
                }),
            },
        })),
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

export function manifestContainsSecret(value, secrets) {
    const serialized = JSON.stringify(value);
    return secrets.filter(Boolean).some((secret) => serialized.includes(secret));
}
