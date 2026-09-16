import { describe, expect, it, vi } from 'vitest';

import {
    buildSceneCapacityCommand,
    cleanupSceneCapacityRoom,
    establishSceneCapacityRoomOwnership,
    expectedSceneCapacityIdentities,
    findSceneCapacityQualification,
    redactSceneCapacityOutput,
    serializeSceneCapacityEvidence,
    validateSceneCapacityTargets,
    validateSceneCapacityObservation,
} from '../../../scripts/lib/livekit-scene-capacity.mjs';

describe('LiveKit scene-capacity qualification', () => {
    it.each([6, 9, 12])('uses %i paired audio/video publishers with no audience load', (publishers) => {
        const args = buildSceneCapacityCommand({
            roomName: `hb-load-scene-${publishers}`,
            publishers,
            durationSeconds: 30,
            rampPerSecond: 3,
            videoCodec: 'vp8',
            layout: publishers === 12 ? '4x4' : '3x3',
        });

        expect(args[args.indexOf('--audio-publishers') + 1]).toBe(String(publishers));
        expect(args[args.indexOf('--video-publishers') + 1]).toBe(String(publishers));
        expect(args[args.indexOf('--subscribers') + 1]).toBe('0');
        expect(args[args.indexOf('--identity-prefix') + 1]).toBe(`hbscene-${publishers}`);
    });

    it.each([0, 5, 7, 10, 13])('rejects unsupported capacity %i', (publishers) => {
        expect(() => buildSceneCapacityCommand({
            roomName: 'hb-load-scene-invalid',
            publishers,
            durationSeconds: 30,
            rampPerSecond: 3,
            videoCodec: 'vp8',
            layout: '4x4',
        })).toThrow(/6, 9, or 12/);
    });

    it('requires the exact synthetic identity set to publish one audio and one video track each', () => {
        const identities = expectedSceneCapacityIdentities(12).map((identity) => ({
            identity,
            audioTracks: 1,
            videoTracks: 1,
        }));
        expect(validateSceneCapacityObservation({
            expectedPublishers: 12,
            identities,
        })).toEqual({ passed: true, failures: [] });

        expect(validateSceneCapacityObservation({
            expectedPublishers: 12,
            identities: identities.map((entry, index) => index === 0
                ? { ...entry, audioTracks: 0 }
                : entry),
        })).toMatchObject({ passed: false });
    });

    it('rejects unrelated identities and aggregate-perfect but misdistributed tracks', () => {
        const identities = expectedSceneCapacityIdentities(6).map((identity) => ({
            identity,
            audioTracks: 1,
            videoTracks: 1,
        }));
        const unrelated = identities.map((entry, index) => index === 0
            ? { ...entry, identity: 'unrelated-publisher' }
            : entry);
        expect(validateSceneCapacityObservation({ expectedPublishers: 6, identities: unrelated }))
            .toMatchObject({ passed: false });

        const misdistributed = identities.map((entry, index) => {
            if (index === 0) return { ...entry, audioTracks: 2, videoTracks: 0 };
            if (index === 1) return { ...entry, audioTracks: 0, videoTracks: 2 };
            return entry;
        });
        expect(validateSceneCapacityObservation({ expectedPublishers: 6, identities: misdistributed }))
            .toMatchObject({ passed: false });
    });

    it('requires exact paired identity evidence in the same observation', () => {
        const identities = expectedSceneCapacityIdentities(6).map((identity) => ({
            identity,
            audioTracks: 1,
            videoTracks: 1,
        }));
        const observations = [
            { identities: identities.map((entry, index) => index === 0 ? { ...entry, videoTracks: 0 } : entry) },
            { identities: identities.map((entry, index) => index === 0 ? { ...entry, audioTracks: 0 } : entry) },
        ];
        expect(findSceneCapacityQualification(observations, 6)).toBeNull();

        const simultaneous = { identities };
        expect(findSceneCapacityQualification([...observations, simultaneous], 6)).toEqual(simultaneous);
    });

    it('rejects reusable base names as remote mutation targets even with matching confirmation', () => {
        expect(() => validateSceneCapacityTargets({
            publicUrl: 'wss://edge.example.invalid/rtc',
            internalUrl: 'https://api.example.invalid',
            roomName: 'hb-load-scene-review-12',
            allowRemote: true,
            confirmation: 'LOADTEST:edge.example.invalid:api.example.invalid:hb-load-scene-review-12',
        })).toThrow(/ownership nonce/);
    });

    it('authorizes both endpoint hosts and binds remote confirmation to both plus the room', () => {
        const roomName = 'hb-load-scene-review-12-11111111111141118111111111111111';
        expect(() => validateSceneCapacityTargets({
            publicUrl: 'ws://localhost:7880',
            internalUrl: 'https://live.example.invalid',
            roomName,
            allowRemote: false,
            confirmation: '',
        })).toThrow(/live\.example\.invalid/);

        const authorized = validateSceneCapacityTargets({
            publicUrl: 'wss://edge.example.invalid/rtc',
            internalUrl: 'https://api.example.invalid',
            roomName,
            allowRemote: true,
            confirmation: `LOADTEST:edge.example.invalid:api.example.invalid:${roomName}`,
        });
        expect(authorized).toMatchObject({
            publicHost: 'edge.example.invalid',
            internalHost: 'api.example.invalid',
        });
    });

    it('redacts both credentials and refuses evidence that still serializes either one', () => {
        const key = 'known-api-key';
        const secret = 'known-api-secret';
        expect(redactSceneCapacityOutput(
            `key=${key} secret=${secret}`,
            [key, secret],
        )).toBe('key=[REDACTED] secret=[REDACTED]');
        expect(() => serializeSceneCapacityEvidence(
            { outputTail: key },
            [key, secret],
        )).toThrow(/credential/);
        expect(serializeSceneCapacityEvidence(
            { outputTail: redactSceneCapacityOutput(secret, [key, secret]) },
            [key, secret],
        )).not.toContain(secret);
    });

    it('fails closed when JSON escaping would obscure a credential in evidence', () => {
        const escapedSecret = 'known-"api\\secret';
        expect(() => serializeSceneCapacityEvidence(
            { outputTail: `leaked ${escapedSecret}` },
            [escapedSecret],
        )).toThrow(/credential/);
    });

    it('configures owned rooms for bounded automatic expiration without explicit deletion', async () => {
        const baseRoomName = 'hb-load-scene-owned-6';
        const ownershipNonce = '11111111-1111-4111-8111-111111111111';
        const roomName = `${baseRoomName}-11111111111141118111111111111111`;
        const metadata = JSON.stringify({
            schemaVersion: 1,
            kind: 'harmonic-beacon-scene-capacity-owner',
            roomName,
            runId: 'owned',
            ownershipNonce,
        });
        const service = {
            listRooms: vi.fn().mockResolvedValueOnce([]),
            createRoom: vi.fn().mockResolvedValue({
                name: roomName,
                metadata,
                emptyTimeout: 60,
                departureTimeout: 60,
            }),
            deleteRoom: vi.fn(),
        };
        const ownership = await establishSceneCapacityRoomOwnership(service, {
            roomName: baseRoomName,
            runId: 'owned',
            ownershipNonce,
        });
        expect(service.createRoom).toHaveBeenCalledWith({
            name: roomName,
            metadata,
            emptyTimeout: 60,
            departureTimeout: 60,
        });
        await expect(cleanupSceneCapacityRoom(service, roomName, ownership))
            .resolves.toEqual({
                attempted: false,
                deleted: false,
                ownedByRun: true,
                strategy: 'livekit-automatic-expiration',
                emptyTimeoutSeconds: 60,
                departureTimeoutSeconds: 60,
            });
        expect(service.deleteRoom).not.toHaveBeenCalled();

        await expect(cleanupSceneCapacityRoom(service, roomName, null))
            .resolves.toEqual({
                attempted: false,
                deleted: false,
                ownedByRun: false,
                strategy: 'none',
            });
        expect(service.deleteRoom).not.toHaveBeenCalled();
    });

    it('fails closed when LiveKit does not confirm bounded automatic expiration', async () => {
        const roomName = 'hb-load-scene-timeout-6-11111111111141118111111111111111';
        const service = {
            listRooms: vi.fn().mockResolvedValue([]),
            createRoom: vi.fn().mockResolvedValue({
                name: roomName,
                metadata: JSON.stringify({
                    schemaVersion: 1,
                    kind: 'harmonic-beacon-scene-capacity-owner',
                    roomName,
                    runId: 'timeout',
                    ownershipNonce: '11111111-1111-4111-8111-111111111111',
                }),
                emptyTimeout: 0,
                departureTimeout: 0,
            }),
        };

        await expect(establishSceneCapacityRoomOwnership(service, {
            roomName: 'hb-load-scene-timeout-6',
            runId: 'timeout',
            ownershipNonce: '11111111-1111-4111-8111-111111111111',
        })).rejects.toThrow(/bounded automatic expiration/);
    });

    it('derives distinct owned room names from the ownership nonce even when base names are reused', async () => {
        const service = {
            listRooms: vi.fn().mockResolvedValue([]),
            createRoom: vi.fn(({
                name,
                metadata,
                emptyTimeout,
                departureTimeout,
            }: {
                name: string;
                metadata: string;
                emptyTimeout: number;
                departureTimeout: number;
            }) => ({ name, metadata, emptyTimeout, departureTimeout })),
        };
        const first = await establishSceneCapacityRoomOwnership(service, {
            roomName: 'hb-load-scene-reusable-6',
            runId: 'first',
            ownershipNonce: '11111111-1111-4111-8111-111111111111',
        });
        const replacement = await establishSceneCapacityRoomOwnership(service, {
            roomName: 'hb-load-scene-reusable-6',
            runId: 'replacement',
            ownershipNonce: '22222222-2222-4222-8222-222222222222',
        });

        expect(first.roomName).not.toBe(replacement.roomName);
        expect(first.roomName).toContain('11111111111141118111111111111111');
        expect(replacement.roomName).toContain('22222222222242228222222222222222');
    });

    it('fails closed if automatic-expiration ownership evidence is incomplete', async () => {
        const service = {
            listRooms: vi.fn(),
            deleteRoom: vi.fn(),
        };

        await expect(cleanupSceneCapacityRoom(service, 'hb-load-scene-owned-6', {
            established: true,
            roomName: 'hb-load-scene-owned-6',
            ownershipNonce: 'nonce-1',
            metadata: 'original-metadata',
        })).resolves.toEqual({
            attempted: false,
            deleted: false,
            ownedByRun: false,
            strategy: 'none',
        });
        expect(service.listRooms).not.toHaveBeenCalled();
        expect(service.deleteRoom).not.toHaveBeenCalled();
    });

    it('never name-deletes a same-name replacement after the ownership snapshot', async () => {
        const roomName = 'hb-load-scene-owned-6-11111111111141118111111111111111';
        const original = { name: roomName, metadata: 'original-metadata' };
        const replacement = { name: roomName, metadata: 'replacement-metadata' };
        let currentRoom: typeof original | null = original;
        const service = {
            listRooms: vi.fn(async () => [{ ...original }]),
            deleteRoom: vi.fn(async () => {
                currentRoom = null;
            }),
        };

        queueMicrotask(() => {
            currentRoom = replacement;
        });
        await cleanupSceneCapacityRoom(service, roomName, {
            established: true,
            roomName,
            ownershipNonce: '11111111-1111-4111-8111-111111111111',
            metadata: original.metadata,
            emptyTimeoutSeconds: 60,
            departureTimeoutSeconds: 60,
        });

        expect(service.listRooms).not.toHaveBeenCalled();
        expect(service.deleteRoom).not.toHaveBeenCalled();
        expect(currentRoom).toBe(replacement);
    });
});
