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

    it('authorizes both endpoint hosts and binds remote confirmation to both plus the room', () => {
        expect(() => validateSceneCapacityTargets({
            publicUrl: 'ws://localhost:7880',
            internalUrl: 'https://live.example.invalid',
            roomName: 'hb-load-scene-review-12',
            allowRemote: false,
            confirmation: '',
        })).toThrow(/live\.example\.invalid/);

        const authorized = validateSceneCapacityTargets({
            publicUrl: 'wss://edge.example.invalid/rtc',
            internalUrl: 'https://api.example.invalid',
            roomName: 'hb-load-scene-review-12',
            allowRemote: true,
            confirmation: 'LOADTEST:edge.example.invalid:api.example.invalid:hb-load-scene-review-12',
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

    it('deletes only a room whose exact ownership nonce was established by this run', async () => {
        const metadata = JSON.stringify({
            schemaVersion: 1,
            kind: 'harmonic-beacon-scene-capacity-owner',
            roomName: 'hb-load-scene-owned-6',
            runId: 'owned',
            ownershipNonce: 'nonce-1',
        });
        const service = {
            listRooms: vi.fn()
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ name: 'hb-load-scene-owned-6', metadata }]),
            createRoom: vi.fn().mockResolvedValue({
                name: 'hb-load-scene-owned-6',
                metadata,
            }),
            deleteRoom: vi.fn().mockResolvedValue(undefined),
        };
        const ownership = await establishSceneCapacityRoomOwnership(service, {
            roomName: 'hb-load-scene-owned-6',
            runId: 'owned',
            ownershipNonce: 'nonce-1',
        });
        await expect(cleanupSceneCapacityRoom(service, 'hb-load-scene-owned-6', ownership))
            .resolves.toMatchObject({ attempted: true, deleted: true, ownedByRun: true });
        expect(service.deleteRoom).toHaveBeenCalledWith('hb-load-scene-owned-6');

        service.deleteRoom.mockClear();
        await expect(cleanupSceneCapacityRoom(service, 'hb-load-scene-owned-6', null))
            .resolves.toMatchObject({ attempted: false, deleted: false, ownedByRun: false });
        expect(service.deleteRoom).not.toHaveBeenCalled();
    });

    it('refuses cleanup if the owned room was replaced before deletion', async () => {
        const service = {
            listRooms: vi.fn().mockResolvedValue([{
                name: 'hb-load-scene-owned-6',
                metadata: JSON.stringify({
                    schemaVersion: 1,
                    kind: 'harmonic-beacon-scene-capacity-owner',
                    roomName: 'hb-load-scene-owned-6',
                    runId: 'other-run',
                    ownershipNonce: 'replacement-nonce',
                }),
            }]),
            deleteRoom: vi.fn(),
        };

        await expect(cleanupSceneCapacityRoom(service, 'hb-load-scene-owned-6', {
            established: true,
            roomName: 'hb-load-scene-owned-6',
            ownershipNonce: 'nonce-1',
            metadata: 'original-metadata',
        })).resolves.toEqual({ attempted: false, deleted: false, ownedByRun: false });
        expect(service.deleteRoom).not.toHaveBeenCalled();
    });
});
