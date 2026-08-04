import { describe, expect, it } from 'vitest';

import {
    buildTapestryManifest,
    MAX_TAPESTRY_MANIFEST_ENTRIES,
    type ManifestLiveParticipant,
    type ManifestParticipant,
} from '../tapestry-manifest';

const NOW = new Date('2026-08-04T12:00:00Z');
const EARLIER = new Date('2026-08-04T11:59:00Z');

function participant(overrides: Partial<ManifestParticipant> = {}): ManifestParticipant {
    return {
        identity: 'lk-a',
        leftAt: null,
        raisedAt: null,
        publishGrantedAt: null,
        publishRevokedAt: null,
        staffName: null,
        ...overrides,
    };
}

function live(overrides: Partial<ManifestLiveParticipant> = {}): ManifestLiveParticipant {
    return { name: 'Ana', media: [], ...overrides };
}

function buildInput(overrides: Record<string, unknown> = {}) {
    return {
        sessionId: 'session-1',
        tileIds: ['tp-a', 'tp-b'],
        frameTtlMs: 10_000,
        liveStateAvailable: true,
        participants: [participant()],
        live: new Map<string, ManifestLiveParticipant>(),
        tapestryIdFor: (identity: string) => `tp-${identity.replace('lk-', '')}`,
        thumbnailUrlFor: (tileId: string) => `/tiles/${tileId}`,
        ...overrides,
    };
}

describe('buildTapestryManifest', () => {
    it('maps tiles in display order with names and defaults', () => {
        const manifest = buildTapestryManifest(buildInput({
            live: new Map([['lk-a', live()]]),
        }));
        expect(manifest.entries).toHaveLength(2);
        expect(manifest.entries[0]).toMatchObject({
            tileId: 'tp-a',
            position: 0,
            displayName: 'Ana',
            handRaised: false,
            queuePosition: null,
            presence: 'connected',
            camera: 'off',
            thumbnailUrl: '/tiles/tp-a',
        });
        // A tile without a database row gets the dignified generic entry.
        expect(manifest.entries[1]).toMatchObject({
            tileId: 'tp-b',
            position: 1,
            displayName: 'Attendee',
            presence: 'reconnecting',
            camera: 'unknown',
        });
    });

    it('marks waiting hands with stable queue positions on tile and summary', () => {
        const manifest = buildTapestryManifest(buildInput({
            participants: [
                participant({ identity: 'lk-b', raisedAt: NOW }),
                participant({ identity: 'lk-a', raisedAt: EARLIER }),
            ],
        }));
        expect(manifest.entries[0]).toMatchObject({ tileId: 'tp-a', handRaised: true, queuePosition: 1 });
        expect(manifest.entries[1]).toMatchObject({ tileId: 'tp-b', handRaised: true, queuePosition: 2 });
        expect(manifest.waitingHands.map((hand) => hand.queuePosition)).toEqual([1, 2]);
        expect(manifest.waitingHands[0].tileId).toBe('tp-a');
    });

    it('lists a waiting hand without a tile in the summary only', () => {
        const manifest = buildTapestryManifest(buildInput({
            participants: [participant({ identity: 'lk-z', raisedAt: NOW })],
        }));
        expect(manifest.entries.every((entry) => !entry.handRaised)).toBe(true);
        expect(manifest.waitingHands).toEqual([
            { displayName: 'Attendee', queuePosition: 1, tileId: null },
        ]);
    });

    it('excludes publishers from the waiting queue', () => {
        const manifest = buildTapestryManifest(buildInput({
            participants: [participant({
                raisedAt: EARLIER,
                publishGrantedAt: NOW,
            })],
        }));
        expect(manifest.entries[0].handRaised).toBe(false);
        expect(manifest.waitingHands).toEqual([]);
    });

    it('derives presence: left, unknown, reconnecting, connected', () => {
        const base = buildInput({
            tileIds: ['tp-a', 'tp-b', 'tp-c', 'tp-d'],
            participants: [
                participant({ identity: 'lk-a', leftAt: NOW }),
                participant({ identity: 'lk-b' }),
                participant({ identity: 'lk-c' }),
                participant({ identity: 'lk-d' }),
            ],
            live: new Map([['lk-d', live()]]),
        });
        const connected = buildTapestryManifest(base);
        expect(connected.entries.map((entry) => entry.presence)).toEqual([
            'left', 'reconnecting', 'reconnecting', 'connected',
        ]);
        const outage = buildTapestryManifest({ ...base, liveStateAvailable: false });
        expect(outage.entries.map((entry) => entry.presence)).toEqual([
            'left', 'unknown', 'unknown', 'unknown',
        ]);
    });

    it('derives camera state from published tracks', () => {
        const manifest = buildTapestryManifest(buildInput({
            participants: [
                participant({ identity: 'lk-a' }),
                participant({ identity: 'lk-b' }),
            ],
            live: new Map([
                ['lk-a', live({ media: [{ source: 'CAMERA', muted: false }] })],
                ['lk-b', live({ media: [{ source: 'CAMERA', muted: true }] })],
            ]),
        }));
        expect(manifest.entries[0].camera).toBe('on');
        expect(manifest.entries[1].camera).toBe('off');
    });

    it('uses the staff account name when the participant is staff', () => {
        const manifest = buildTapestryManifest(buildInput({
            participants: [participant({ staffName: 'Julián' })],
            live: new Map([['lk-a', live()]]),
        }));
        expect(manifest.entries[0].displayName).toBe('Julián');
    });

    it('bounds entries to the manifest cap', () => {
        const tileIds = Array.from(
            { length: MAX_TAPESTRY_MANIFEST_ENTRIES + 10 },
            (_, index) => `tp-${index}`,
        );
        const manifest = buildTapestryManifest(buildInput({ tileIds, participants: [] }));
        expect(manifest.entries).toHaveLength(MAX_TAPESTRY_MANIFEST_ENTRIES);
    });

    it('changes revision when state changes and keeps it when identical', () => {
        const input = buildInput({ participants: [participant()] });
        const first = buildTapestryManifest(input);
        const same = buildTapestryManifest(input);
        expect(first.revision).toBe(same.revision);
        const raised = buildTapestryManifest({
            ...input,
            participants: [participant({ raisedAt: NOW })],
        });
        expect(raised.revision).not.toBe(first.revision);
        const reordered = buildTapestryManifest({
            ...input,
            tileIds: ['tp-b', 'tp-a'],
        });
        expect(reordered.revision).not.toBe(first.revision);
    });

    it('skips participants whose identity cannot be mapped to a tile id', () => {
        const manifest = buildTapestryManifest(buildInput({
            tapestryIdFor: () => null,
        }));
        expect(manifest.entries[0]).toMatchObject({
            tileId: 'tp-a',
            displayName: 'Attendee',
            presence: 'reconnecting',
        });
    });

    it('rounds the freshness TTL up to whole seconds', () => {
        const manifest = buildTapestryManifest(buildInput({ frameTtlMs: 10_500 }));
        expect(manifest.thumbnailFreshForSeconds).toBe(11);
    });
});
