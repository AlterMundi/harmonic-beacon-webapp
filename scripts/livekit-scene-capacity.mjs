#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomServiceClient, TrackType } from 'livekit-server-sdk';

import {
    buildSceneCapacityCommand,
    cleanupSceneCapacityRoom,
    establishSceneCapacityRoomOwnership,
    findSceneCapacityQualification,
    redactSceneCapacityOutput,
    serializeSceneCapacityEvidence,
    validateSceneCapacityObservation,
    validateSceneCapacityTargets,
} from './lib/livekit-scene-capacity.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_PROFILES = new Set(['scene-6', 'scene-9', 'scene-12']);

function option(name, fallback) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

function safeRunId(value) {
    const runId = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
    if (runId.length < 3) throw new Error('run id must contain at least three safe characters');
    return runId;
}

function capacityForProfile(profileName) {
    if (!ALLOWED_PROFILES.has(profileName)) {
        throw new Error('profile must be scene-6, scene-9, or scene-12');
    }
    return Number(profileName.slice('scene-'.length));
}

function observe(participants) {
    return {
        identities: participants.map((participant) => ({
            identity: participant.identity,
            audioTracks: participant.tracks.filter((track) => track.type === TrackType.AUDIO).length,
            videoTracks: participant.tracks.filter((track) => track.type === TrackType.VIDEO).length,
        })).sort((left, right) => left.identity.localeCompare(right.identity)),
    };
}

async function run() {
    if (hasFlag('--help')) {
        process.stdout.write(
            'Usage: npm run load:scene-capacity -- --profile scene-12 [options]\n' +
            '  --run-id ID\n  --duration SECONDS\n  --ramp-per-second N\n' +
            '  --url URL\n  --lk-bin PATH\n  --manifest PATH\n  --dry-run\n' +
            '  --allow-remote --confirm-test-room LOADTEST:<public-host>:<internal-host>:<room>\n',
        );
        return;
    }

    const profileName = option('--profile', 'scene-12');
    const publishers = capacityForProfile(profileName);
    const runId = safeRunId(option('--run-id', new Date().toISOString().replace(/\D/g, '').slice(0, 14)));
    const durationSeconds = Number(option('--duration', '90'));
    const rampPerSecond = Number(option('--ramp-per-second', '3'));
    const roomName = `hb-load-scene-${runId}-${publishers}`;
    const url = option('--url', process.env.LIVEKIT_URL ?? 'ws://localhost:7880');
    const apiUrl = process.env.LIVEKIT_INTERNAL_URL ?? url;
    const lkBinary = option('--lk-bin', 'lk');
    const manifestPath = resolve(
        repositoryRoot,
        option('--manifest', `artifacts/load-test/${runId}-${profileName}.json`),
    );
    const targets = validateSceneCapacityTargets({
        publicUrl: url,
        internalUrl: apiUrl,
        roomName,
        allowRemote: hasFlag('--allow-remote'),
        confirmation: option('--confirm-test-room', ''),
    });

    const args = buildSceneCapacityCommand({
        roomName,
        publishers,
        durationSeconds,
        rampPerSecond,
        videoCodec: 'vp8',
        layout: publishers === 12 ? '4x4' : '3x3',
    });
    const manifest = {
        schemaVersion: 1,
        kind: 'harmonic-beacon-scene-capacity',
        status: hasFlag('--dry-run') ? 'PLANNED' : 'RUNNING',
        profileName,
        runId,
        roomName,
        expectedPublishers: publishers,
        requiresDistinctPairedMediaIdentities: true,
        targetPublicHost: targets.publicHost,
        targetInternalHost: targets.internalHost,
        command: [lkBinary, ...args],
        startedAt: new Date().toISOString(),
        observations: [],
    };
    await mkdir(dirname(manifestPath), { recursive: true });

    if (hasFlag('--dry-run')) {
        await writeFile(manifestPath, serializeSceneCapacityEvidence(manifest, []), { mode: 0o600 });
        process.stdout.write(`${manifestPath}\n`);
        return;
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required');
    const credentials = [apiKey, apiSecret];
    const roomService = new RoomServiceClient(apiUrl, apiKey, apiSecret);
    let outputTail = '';
    let child;
    let roomOwnership = null;
    const stop = (signal) => child?.kill(signal);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    try {
        const ownershipNonce = randomUUID();
        roomOwnership = await establishSceneCapacityRoomOwnership(roomService, {
            roomName,
            runId,
            ownershipNonce,
        });
        manifest.roomOwnership = { established: true, ownershipNonce };

        child = spawn(lkBinary, args, {
            cwd: repositoryRoot,
            env: {
                PATH: process.env.PATH ?? '',
                LIVEKIT_URL: url,
                LIVEKIT_API_KEY: apiKey,
                LIVEKIT_API_SECRET: apiSecret,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        for (const stream of [child.stdout, child.stderr]) {
            stream.on('data', (chunk) => {
                outputTail = `${outputTail}${chunk.toString()}`.slice(-64 * 1024);
            });
        }

        let settled = false;
        const exit = new Promise((resolveExit) => {
            child.on('error', (error) => {
                settled = true;
                resolveExit({
                    code: 127,
                    signal: null,
                    error: redactSceneCapacityOutput(error.message, credentials),
                });
            });
            child.on('close', (code, signal) => {
                settled = true;
                resolveExit({ code: code ?? 1, signal, error: null });
            });
        });

        while (!settled) {
            try {
                const participants = await roomService.listParticipants(roomName);
                const sample = observe(participants);
                manifest.observations.push({ at: new Date().toISOString(), ...sample });
            } catch {
                // The owned room may briefly be unavailable during bounded startup.
            }
            await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        }

        const exitResult = await exit;
        const qualifiedObservation = findSceneCapacityQualification(
            manifest.observations,
            publishers,
        );
        const qualification = qualifiedObservation
            ? { passed: true, failures: [] }
            : validateSceneCapacityObservation({ expectedPublishers: publishers, identities: [] });
        manifest.status = exitResult.code === 0 && qualification.passed ? 'PASS' : 'FAIL';
        manifest.endedAt = new Date().toISOString();
        manifest.exit = exitResult;
        manifest.qualifiedObservation = qualifiedObservation;
        manifest.qualification = qualification;
        manifest.outputTail = redactSceneCapacityOutput(outputTail, credentials);
        if (manifest.outputTail) process.stdout.write(manifest.outputTail);
    } catch (error) {
        manifest.status = 'FAIL';
        manifest.endedAt = new Date().toISOString();
        manifest.error = redactSceneCapacityOutput(
            error instanceof Error ? error.message : String(error),
            credentials,
        );
    } finally {
        manifest.cleanup = await cleanupSceneCapacityRoom(
            roomService,
            roomName,
            roomOwnership,
        );
        await writeFile(
            manifestPath,
            serializeSceneCapacityEvidence(manifest, credentials),
            { mode: 0o600 },
        );
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
    }

    process.stdout.write(`${manifestPath}\n`);
    if (manifest.status !== 'PASS') process.exitCode = 1;
}

run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
