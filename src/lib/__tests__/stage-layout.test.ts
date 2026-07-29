import { describe, it, expect } from 'vitest';

import {
    AUXILIARY_DIMENSIONS,
    MAX_AUXILIARY_TILES,
    SPOTLIGHT_DIMENSIONS,
    STAGE_MAX_PUBLISHERS,
    selectStageArrangement,
    type StagePublisher,
} from '@/lib/stage-layout';

/**
 * WEEKEND_MVP_ROADMAP.md WS2-02: "every audience client renders exactly one
 * spotlight at the 720p-sized layout and at most five 360p-sized tiles;
 * non-publishers never create tiles" and "active-speaker change moves the
 * speaker to the spotlight".
 *
 * Those are decisions about *who* occupies *which* slot, so they are provable
 * here without a browser, a room, or an SDK mock.
 */

function publisher(overrides: Partial<StagePublisher> & { identity: string }): StagePublisher {
    return {
        label: 'Attendee',
        isLocal: false,
        isFacilitator: false,
        isSpeaking: false,
        cameraOn: true,
        micOn: true,
        connectionQuality: 'excellent',
        grantOrder: 0,
        ...overrides,
    };
}

/** Julián plus five rotating slots, in the order a stage fills up. */
function sixPublishers(): StagePublisher[] {
    return [
        publisher({ identity: 'julian', label: 'Facilitator', isFacilitator: true, grantOrder: 0 }),
        publisher({ identity: 'aux-1', grantOrder: 1 }),
        publisher({ identity: 'aux-2', grantOrder: 2 }),
        publisher({ identity: 'aux-3', grantOrder: 3 }),
        publisher({ identity: 'aux-4', grantOrder: 4 }),
        publisher({ identity: 'aux-5', grantOrder: 5 }),
    ];
}

describe('stage-layout constants', () => {
    it('pins the weekend cap at six tiles: one spotlight plus five auxiliaries', () => {
        expect(STAGE_MAX_PUBLISHERS).toBe(6);
        expect(MAX_AUXILIARY_TILES).toBe(5);
    });

    it('asks for the 720p layer in the spotlight and 360p in the strip', () => {
        expect(SPOTLIGHT_DIMENSIONS).toEqual({ width: 1280, height: 720 });
        expect(AUXILIARY_DIMENSIONS).toEqual({ width: 640, height: 360 });
    });
});

describe('selectStageArrangement - the six slots', () => {
    it('gives Julián and five auxiliaries exactly one spotlight and five strip tiles', () => {
        const { spotlight, auxiliaries, overflow } = selectStageArrangement(sixPublishers(), {
            activeSpeakerIdentity: 'julian',
        });

        expect(spotlight?.identity).toBe('julian');
        expect(auxiliaries.map((p) => p.identity)).toEqual([
            'aux-1',
            'aux-2',
            'aux-3',
            'aux-4',
            'aux-5',
        ]);
        expect(overflow).toEqual([]);
    });

    it('renders no tiles at all when nobody holds a stage grant', () => {
        expect(selectStageArrangement([])).toEqual({
            spotlight: null,
            auxiliaries: [],
            overflow: [],
        });
    });

    it('refuses a seventh tile even if the room reports a seventh publisher', () => {
        // The database reservation (WS3-01) is what stops a seventh grant. The
        // client must not decode a seventh stream on the strength of that.
        const eight = [
            ...sixPublishers(),
            publisher({ identity: 'aux-6', grantOrder: 6 }),
            publisher({ identity: 'aux-7', grantOrder: 7 }),
        ];

        const { spotlight, auxiliaries, overflow } = selectStageArrangement(eight, {
            activeSpeakerIdentity: 'julian',
        });

        expect(auxiliaries).toHaveLength(MAX_AUXILIARY_TILES);
        expect(1 + auxiliaries.length).toBe(STAGE_MAX_PUBLISHERS);
        expect(overflow.map((p) => p.identity)).toEqual(['aux-6', 'aux-7']);
        expect([spotlight, ...auxiliaries].map((p) => p?.identity)).not.toContain('aux-6');
    });

    it('collapses a duplicated identity instead of rendering it twice', () => {
        const twice = [publisher({ identity: 'aux-1' }), publisher({ identity: 'aux-1' })];

        const { spotlight, auxiliaries } = selectStageArrangement(twice);

        expect(spotlight?.identity).toBe('aux-1');
        expect(auxiliaries).toEqual([]);
    });
});

describe('selectStageArrangement - who gets the spotlight', () => {
    it('moves the active speaker into the spotlight', () => {
        const { spotlight, auxiliaries } = selectStageArrangement(sixPublishers(), {
            activeSpeakerIdentity: 'aux-3',
        });

        expect(spotlight?.identity).toBe('aux-3');
        expect(auxiliaries.map((p) => p.identity)).toEqual([
            'julian',
            'aux-1',
            'aux-2',
            'aux-4',
            'aux-5',
        ]);
    });

    it('keeps the strip in grant order as the speaker changes, so tiles do not shuffle', () => {
        const publishers = sixPublishers();
        const firstSpeaker = selectStageArrangement(publishers, { activeSpeakerIdentity: 'aux-1' });
        const secondSpeaker = selectStageArrangement(publishers, { activeSpeakerIdentity: 'aux-5' });

        // Only the two swapped identities move; everyone else holds their slot.
        expect(firstSpeaker.auxiliaries.map((p) => p.identity)).toEqual([
            'julian',
            'aux-2',
            'aux-3',
            'aux-4',
            'aux-5',
        ]);
        expect(secondSpeaker.auxiliaries.map((p) => p.identity)).toEqual([
            'julian',
            'aux-1',
            'aux-2',
            'aux-3',
            'aux-4',
        ]);
    });

    it('lets an operator pin override the active speaker', () => {
        // Roadmap cut-line 3: automatic switching degrades to an operator pin.
        const { spotlight } = selectStageArrangement(sixPublishers(), {
            pinnedIdentity: 'julian',
            activeSpeakerIdentity: 'aux-3',
        });

        expect(spotlight?.identity).toBe('julian');
    });

    it('spotlights the newest grant when nobody is pinned or speaking', () => {
        // "The spotlight follows the facilitator-promoted publisher": the
        // protagonist who was just given the floor is the one to watch.
        const { spotlight } = selectStageArrangement([
            publisher({ identity: 'julian', label: 'Facilitator', isFacilitator: true, grantOrder: 0 }),
            publisher({ identity: 'aux-1', grantOrder: 1 }),
            publisher({ identity: 'protagonist', grantOrder: 2 }),
        ]);

        expect(spotlight?.identity).toBe('protagonist');
    });

    it('spotlights the facilitator on an otherwise empty stage', () => {
        const { spotlight } = selectStageArrangement([
            publisher({ identity: 'operator', label: 'Operator', grantOrder: 0 }),
            publisher({ identity: 'julian', label: 'Facilitator', isFacilitator: true, grantOrder: 0 }),
        ]);

        expect(spotlight?.identity).toBe('julian');
    });

    it('falls back rather than blanking the stage when the speaker or pin has left', () => {
        // A demoted or disconnected identity leaves a stale pin/speaker behind.
        // The stage keeps six tiles and falls through to the newest grant.
        const publishers = sixPublishers();

        const stalePin = selectStageArrangement(publishers, { pinnedIdentity: 'departed' });
        const staleSpeaker = selectStageArrangement(publishers, {
            activeSpeakerIdentity: 'departed',
        });

        expect(stalePin.spotlight?.identity).toBe('aux-5');
        expect(staleSpeaker.spotlight?.identity).toBe('aux-5');
        expect(stalePin.auxiliaries).toHaveLength(5);
    });

    it('puts the same identities back in the same slots after a rejoin', () => {
        // A rejoin re-reads the room in whatever order the SDK hands it over.
        // Slot order comes from the retained grant order, not from arrival order.
        const original = sixPublishers();
        const afterRejoin = [...original].reverse();

        const before = selectStageArrangement(original, { activeSpeakerIdentity: 'aux-2' });
        const after = selectStageArrangement(afterRejoin, { activeSpeakerIdentity: 'aux-2' });

        expect(after.spotlight?.identity).toBe(before.spotlight?.identity);
        expect(after.auxiliaries.map((p) => p.identity)).toEqual(
            before.auxiliaries.map((p) => p.identity),
        );
    });
});
