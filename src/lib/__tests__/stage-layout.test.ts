import { describe, expect, it } from 'vitest';

import {
    AUXILIARY_DIMENSIONS,
    MAX_AUXILIARY_TILES,
    SPOTLIGHT_DIMENSIONS,
    STAGE_MAX_PUBLISHERS,
    composeStageScene,
    stagePresenceTone,
    type StagePublisher,
} from '@/lib/stage-layout';

function publisher(overrides: Partial<StagePublisher> & { identity: string }): StagePublisher {
    return {
        label: overrides.identity,
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

function roster(count = 6): StagePublisher[] {
    return [
        publisher({ identity: 'facilitator', isFacilitator: true, grantOrder: 0 }),
        ...Array.from({ length: Math.max(0, count - 1) }, (_, index) =>
            publisher({ identity: `person-${index + 1}`, grantOrder: index + 1 }),
        ),
    ].slice(0, count);
}

describe('stage scene constants', () => {
    it('keeps the six-decoder cap and one high/five standard dimensions', () => {
        expect(STAGE_MAX_PUBLISHERS).toBe(6);
        expect(MAX_AUXILIARY_TILES).toBe(5);
        expect(SPOTLIGHT_DIMENSIONS).toEqual({ width: 1280, height: 720 });
        expect(AUXILIARY_DIMENSIONS).toEqual({ width: 640, height: 360 });
    });
});

describe('composeStageScene — composition grammar', () => {
    it.each([
        [0, 'empty'],
        [1, 'solo'],
        [2, 'dyad'],
        [3, 'circle'],
        [4, 'circle'],
        [5, 'chorus'],
        [6, 'chorus'],
    ] as const)('maps %i members to %s', (count, kind) => {
        expect(composeStageScene(roster(count)).kind).toBe(kind);
    });

    it('collapses duplicate identities before applying the cap and keeps the first record', () => {
        const first = publisher({ identity: 'same', label: 'First', grantOrder: 0 });
        const duplicate = publisher({ identity: 'same', label: 'Duplicate', grantOrder: 9 });
        const composition = composeStageScene([first, duplicate]);

        expect(composition.placements).toHaveLength(1);
        expect(composition.placements[0].member).toBe(first);
        expect(composition.overflow).toEqual([]);
    });

    it('caps the canonical grant roster before protagonist selection', () => {
        const eight = [
            ...roster(),
            publisher({ identity: 'seventh', grantOrder: 6 }),
            publisher({ identity: 'eighth', grantOrder: 7 }),
        ];
        const composition = composeStageScene(eight, { protagonistIdentity: 'eighth' });

        expect(composition.placements).toHaveLength(6);
        expect(composition.overflow.map((member) => member.identity)).toEqual(['seventh', 'eighth']);
        expect(composition.placements.map(({ member }) => member.identity)).not.toContain('eighth');
        expect(composition.placements[0].member.identity).toBe('person-5');
    });

    it('is permutation-independent when durable grant order is unchanged', () => {
        const members = roster();
        const expected = composeStageScene(members).placements.map(({ member }) => member.identity);

        expect(
            composeStageScene([...members].reverse()).placements.map(({ member }) => member.identity),
        ).toEqual(expected);
        expect(
            composeStageScene([members[3], members[0], members[5], members[2], members[4], members[1]])
                .placements.map(({ member }) => member.identity),
        ).toEqual(expected);
    });

    it('uses identity as deterministic tie-breaker', () => {
        const composition = composeStageScene([
            publisher({ identity: 'b', grantOrder: 2 }),
            publisher({ identity: 'a', grantOrder: 2 }),
        ]);

        // The newest stable canonical non-facilitator is the final tie-broken member.
        expect(composition.placements.map(({ member }) => member.identity)).toEqual(['b', 'a']);
    });
});

describe('composeStageScene — dramaturgical roles and stable order', () => {
    it('selects the newest non-facilitator, then facilitator, then holders', () => {
        const composition = composeStageScene(roster(4));

        expect(composition.placements.map(({ member, role }) => [member.identity, role])).toEqual([
            ['person-3', 'protagonist'],
            ['facilitator', 'holder'],
            ['person-1', 'holder'],
            ['person-2', 'holder'],
        ]);
    });

    it('makes facilitator and protagonist co-equal dyad members', () => {
        const composition = composeStageScene(roster(2));

        expect(composition.placements.map(({ member, role }) => [member.identity, role])).toEqual([
            ['person-1', 'protagonist'],
            ['facilitator', 'facilitator'],
        ]);
    });

    it('truthfully labels a facilitator-only solo', () => {
        expect(composeStageScene(roster(1)).placements[0].role).toBe('facilitator');
    });

    it('accepts a valid shared protagonist and deterministically ignores a stale one', () => {
        const members = roster(4);

        expect(
            composeStageScene(members, { protagonistIdentity: 'person-1' }).placements[0].member.identity,
        ).toBe('person-1');
        expect(
            composeStageScene(members, { protagonistIdentity: 'departed' }).placements[0].member.identity,
        ).toBe('person-3');
    });

    it('does not change roles or order when the active speaker changes', () => {
        const members = roster();
        const first = composeStageScene(members, { activeSpeakerIdentity: 'person-1' });
        const second = composeStageScene(members, { activeSpeakerIdentity: 'person-4' });

        expect(second.placements.map(({ member, role, order }) => [member.identity, role, order])).toEqual(
            first.placements.map(({ member, role, order }) => [member.identity, role, order]),
        );
        expect(first.placements.find(({ quality }) => quality === 'high')?.member.identity).toBe('person-1');
        expect(second.placements.find(({ quality }) => quality === 'high')?.member.identity).toBe('person-4');
    });
});

describe('composeStageScene — video quality without social reordering', () => {
    it('gives exactly one connected camera high quality and the others standard', () => {
        const composition = composeStageScene(roster());

        expect(composition.placements.filter(({ quality }) => quality === 'high')).toHaveLength(1);
        expect(composition.placements.filter(({ quality }) => quality === 'standard')).toHaveLength(5);
    });

    it('gives camera-off and reconnecting members no decoder request without moving them', () => {
        const members = roster(4);
        members[1] = publisher({ ...members[1], identity: members[1].identity, cameraOn: false });
        members[2] = publisher({
            ...members[2],
            identity: members[2].identity,
            presence: 'reconnecting',
        });
        const baselineOrder = composeStageScene(roster(4)).placements.map(({ member }) => member.identity);
        const composition = composeStageScene(members, { activeSpeakerIdentity: members[1].identity });

        expect(composition.placements.map(({ member }) => member.identity)).toEqual(baselineOrder);
        expect(composition.placements.find(({ member }) => member.identity === members[1].identity)?.quality).toBe('none');
        expect(composition.placements.find(({ member }) => member.identity === members[2].identity)?.quality).toBe('none');
        expect(composition.placements.filter(({ quality }) => quality === 'high')).toHaveLength(1);
    });

    it('falls back to the first connected camera when protagonist and active speaker cannot decode', () => {
        const members = roster(3);
        members[2] = publisher({ ...members[2], identity: members[2].identity, cameraOn: false });
        members[1] = publisher({ ...members[1], identity: members[1].identity, cameraOn: false });
        const composition = composeStageScene(members, { activeSpeakerIdentity: 'person-1' });

        expect(composition.placements.find(({ quality }) => quality === 'high')?.member.identity).toBe('facilitator');
    });

    it('requests no high layer when every camera is unavailable', () => {
        const composition = composeStageScene(roster(3).map((member) => ({ ...member, cameraOn: false })));
        expect(composition.placements.every(({ quality }) => quality === 'none')).toBe(true);
    });
});

describe('stagePresenceTone', () => {
    it('is stable, bounded, and not derived from the display name', () => {
        expect(stagePresenceTone('opaque-a')).toBe(stagePresenceTone('opaque-a'));
        for (const identity of ['opaque-a', 'opaque-b', 'opaque-c', 'opaque-d', 'opaque-e']) {
            expect(stagePresenceTone(identity)).toBeGreaterThanOrEqual(0);
            expect(stagePresenceTone(identity)).toBeLessThanOrEqual(3);
        }
    });
});
