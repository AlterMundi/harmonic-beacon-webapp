const ALLOWED_CAPACITIES = new Set([6, 9, 12]);
const SAFE_ROOM = /^hb-load-scene-[a-z0-9-]+$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function requireCapacity(capacity) {
    if (!ALLOWED_CAPACITIES.has(capacity)) {
        throw new Error('scene capacity must be 6, 9, or 12 publishers');
    }
}

export function buildSceneCapacityCommand({
    roomName,
    publishers,
    durationSeconds,
    rampPerSecond,
    videoCodec,
    layout,
}) {
    requireCapacity(publishers);
    if (!SAFE_ROOM.test(roomName)) {
        throw new Error('scene capacity room must use the hb-load-scene- prefix');
    }
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1) {
        throw new Error('durationSeconds must be a positive integer');
    }
    if (!Number.isInteger(rampPerSecond) || rampPerSecond < 1) {
        throw new Error('rampPerSecond must be a positive integer');
    }
    if (!['vp8', 'h264'].includes(videoCodec)) {
        throw new Error('videoCodec must be vp8 or h264');
    }
    if (!['speaker', '3x3', '4x4', '5x5'].includes(layout)) {
        throw new Error('layout must be speaker, 3x3, 4x4, or 5x5');
    }

    return [
        'load-test',
        '--room', roomName,
        '--identity-prefix', `hbscene-${publishers}`,
        '--duration', `${durationSeconds}s`,
        '--subscribers', '0',
        '--num-per-second', String(rampPerSecond),
        '--audio-publishers', String(publishers),
        '--video-publishers', String(publishers),
        '--video-resolution', 'high',
        '--video-codec', videoCodec,
        '--layout', layout,
    ];
}

export function expectedSceneCapacityIdentities(expectedPublishers) {
    requireCapacity(expectedPublishers);
    // Pinned livekit-cli v2.16.3 appends `_pub` to the configured prefix and
    // LoadTester appends the zero-based sequence. Audio/video publisher counts
    // are equal, so each expected identity owns exactly one of each track.
    return Array.from(
        { length: expectedPublishers },
        (_, index) => `hbscene-${expectedPublishers}_pub_${index}`,
    );
}

export function validateSceneCapacityObservation({ expectedPublishers, identities }) {
    requireCapacity(expectedPublishers);
    const failures = [];
    if (!Array.isArray(identities)) {
        return { passed: false, failures: ['identity evidence is absent'] };
    }

    const expected = expectedSceneCapacityIdentities(expectedPublishers);
    const expectedSet = new Set(expected);
    const observed = new Map();
    for (const entry of identities) {
        if (!entry || typeof entry.identity !== 'string') {
            failures.push('observed participant has no valid identity');
            continue;
        }
        if (observed.has(entry.identity)) {
            failures.push(`duplicate participant identity ${entry.identity}`);
            continue;
        }
        observed.set(entry.identity, entry);
    }

    const missing = expected.filter((identity) => !observed.has(identity));
    const unrelated = [...observed.keys()].filter((identity) => !expectedSet.has(identity));
    if (missing.length > 0) failures.push(`missing expected identities: ${missing.join(', ')}`);
    if (unrelated.length > 0) failures.push(`unexpected identities: ${unrelated.join(', ')}`);

    for (const identity of expected) {
        const entry = observed.get(identity);
        if (!entry) continue;
        if (entry.audioTracks !== 1) {
            failures.push(`expected ${identity} to publish exactly one audio track, observed ${entry.audioTracks}`);
        }
        if (entry.videoTracks !== 1) {
            failures.push(`expected ${identity} to publish exactly one video track, observed ${entry.videoTracks}`);
        }
    }
    return { passed: failures.length === 0, failures };
}

export function findSceneCapacityQualification(observations, expectedPublishers) {
    return observations.find((observation) => validateSceneCapacityObservation({
        expectedPublishers,
        ...observation,
    }).passed) ?? null;
}

function parseEndpoint(label, value) {
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${label} must be a valid URL`);
    }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
        throw new Error(`${label} must use http, https, ws, or wss`);
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error(`${label} must not contain credentials, a query, or a fragment`);
    }
    return parsed;
}

export function sceneCapacityConfirmation({ publicHost, internalHost, roomName }) {
    return `LOADTEST:${publicHost}:${internalHost}:${roomName}`;
}

export function validateSceneCapacityTargets({
    publicUrl,
    internalUrl,
    roomName,
    allowRemote,
    confirmation,
}) {
    if (!SAFE_ROOM.test(roomName)) {
        throw new Error('scene capacity room must use the hb-load-scene- prefix');
    }
    const publicEndpoint = parseEndpoint('LiveKit public endpoint', publicUrl);
    const internalEndpoint = parseEndpoint('LiveKit internal endpoint', internalUrl);
    const publicHost = publicEndpoint.host;
    const internalHost = internalEndpoint.host;
    const expectedConfirmation = sceneCapacityConfirmation({ publicHost, internalHost, roomName });
    const remoteHosts = [publicEndpoint, internalEndpoint]
        .filter((endpoint) => !LOCAL_HOSTS.has(endpoint.hostname))
        .map((endpoint) => endpoint.host);
    if (remoteHosts.length > 0 && (!allowRemote || confirmation !== expectedConfirmation)) {
        throw new Error(
            `remote target(s) ${remoteHosts.join(', ')} require --allow-remote and ` +
            `--confirm-test-room ${expectedConfirmation}`,
        );
    }
    return { publicHost, internalHost, expectedConfirmation };
}

export function redactSceneCapacityOutput(value, credentials) {
    let redacted = String(value ?? '');
    for (const credential of credentials) {
        if (typeof credential === 'string' && credential.length > 0) {
            redacted = redacted.split(credential).join('[REDACTED]');
        }
    }
    return redacted;
}

export function serializeSceneCapacityEvidence(evidence, credentials) {
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    const credentialSerialized = credentials.some((credential) => {
        if (typeof credential !== 'string' || credential.length === 0) return false;
        const jsonEscapedCredential = JSON.stringify(credential).slice(1, -1);
        return serialized.includes(credential) || serialized.includes(jsonEscapedCredential);
    });
    if (credentialSerialized) {
        throw new Error('refusing to serialize scene-capacity evidence containing a credential');
    }
    return serialized;
}

export async function establishSceneCapacityRoomOwnership(roomService, {
    roomName,
    runId,
    ownershipNonce,
}) {
    const existingRooms = await roomService.listRooms([roomName]);
    if (existingRooms.length > 0) {
        throw new Error('refusing to use a scene-capacity room that already exists');
    }
    const metadata = JSON.stringify({
        schemaVersion: 1,
        kind: 'harmonic-beacon-scene-capacity-owner',
        roomName,
        runId,
        ownershipNonce,
    });
    const createdRoom = await roomService.createRoom({ name: roomName, metadata });
    if (createdRoom.name !== roomName || createdRoom.metadata !== metadata) {
        throw new Error('LiveKit did not confirm ownership of the newly created test room');
    }
    return { established: true, roomName, ownershipNonce, metadata };
}

export async function cleanupSceneCapacityRoom(roomService, roomName, ownership) {
    if (
        !ownership?.established ||
        ownership.roomName !== roomName ||
        typeof ownership.metadata !== 'string'
    ) {
        return { attempted: false, deleted: false, ownedByRun: false };
    }
    try {
        const rooms = await roomService.listRooms([roomName]);
        const current = rooms.length === 1 ? rooms[0] : null;
        if (
            current?.name !== roomName ||
            current.metadata !== ownership.metadata
        ) {
            return { attempted: false, deleted: false, ownedByRun: false };
        }
        await roomService.deleteRoom(roomName);
        return { attempted: true, deleted: true, ownedByRun: true };
    } catch {
        return { attempted: true, deleted: false, ownedByRun: true };
    }
}
