import { describe, expect, it } from 'vitest';

import type { CompositeLayout } from '../tapestry-layout';
import {
    buildTapestryManifest,
    type ManifestLiveParticipant,
    type ManifestParticipant,
} from '../tapestry-manifest';

const SESSION_ID = 'session-1';

function participant(overrides: Partial<ManifestParticipant> = {}): ManifestParticipant {
    return {
        identity: 'lk-ana',
        leftAt: null,
        raisedAt: null,
        publishGrantedAt: null,
        publishRevokedAt: null,
        staffName: null,
        ...overrides,
    };
}

function layout(cells: Array<{ id: string; column: number; row: number }>, overrides: Partial<CompositeLayout> = {}): CompositeLayout {
    return {
        revision: 7,
        columns: 2,
        rows: 1,
        tileSizePx: 100,
        frameTtlMs: 10_000,
        cells,
        ...overrides,
    };
}

function live(name: string, media: ManifestLiveParticipant['media'] = []): ManifestLiveParticipant {
    return { name, media };
}

function build(overrides: Partial<Parameters<typeof buildTapestryManifest>[0]> = {}) {
    return buildTapestryManifest({
        sessionId: SESSION_ID,
        layout: layout([{ id: 'tp-lk-ana', column: 0, row: 0 }]),
        liveStateAvailable: true,
        participants: [participant()],
        live: new Map([['lk-ana', live('Ana', [{ source: 'CAMERA', muted: false }])]]),
        tapestryIdFor: (identity: string) => `tp-${identity}`,
        ...overrides,
    });
}

describe('buildTapestryManifest', () => {
    it('maps a tiled participant to name, cell, presence and camera', () => {
        const manifest = build();
        expect(manifest.entries).toEqual([
            {
                tileId: 'tp-lk-ana',
                displayName: 'Ana',
                handRaised: false,
                queuePosition: null,
                presence: 'connected',
                camera: 'on',
                column: 0,
                row: 0,
            },
        ]);
        expect(manifest.layout).toEqual({ revision: 7, columns: 2, rows: 1, tileSizePx: 100 });
        expect(manifest.tileFreshForSeconds).toBe(10);
        expect(manifest.waitingHands).toEqual([]);
    });

    it('marks a waiting hand with its queue position', () => {
        const manifest = build({
            participants: [participant({ raisedAt: new Date('2026-08-04T12:00:00Z') })],
        });
        expect(manifest.entries[0]).toMatchObject({ handRaised: true, queuePosition: 1 });
        expect(manifest.waitingHands).toEqual([
            { displayName: 'Ana', queuePosition: 1, tileId: 'tp-lk-ana' },
        ]);
    });

    it('does not treat an on-stage publisher as a waiting hand', () => {
        const manifest = build({
            participants: [participant({
                raisedAt: new Date('2026-08-04T12:00:00Z'),
                publishGrantedAt: new Date('2026-08-04T12:01:00Z'),
            })],
        });
        expect(manifest.entries[0]).toMatchObject({ handRaised: false, queuePosition: null });
        expect(manifest.waitingHands).toEqual([]);
    });

    it('counts a re-raiser after a revoked grant as waiting again', () => {
        const manifest = build({
            participants: [participant({
                raisedAt: new Date('2026-08-04T12:05:00Z'),
                publishGrantedAt: new Date('2026-08-04T12:01:00Z'),
                publishRevokedAt: new Date('2026-08-04T12:03:00Z'),
            })],
        });
        expect(manifest.entries[0]).toMatchObject({ handRaised: true, queuePosition: 1 });
    });

    it('prefers the staff account name over the LiveKit name', () => {
        const manifest = build({
            participants: [participant({ staffName: 'Julián' })],
        });
        expect(manifest.entries[0].displayName).toBe('Julián');
    });

    it('reports presence states truthfully', () => {
        const left = build({
            participants: [participant({ leftAt: new Date() })],
            live: new Map(),
        });
        expect(left.entries[0].presence).toBe('left');

        const reconnecting = build({ live: new Map() });
        expect(reconnecting.entries[0].presence).toBe('reconnecting');

        const unknown = build({ liveStateAvailable: false });
        expect(unknown.entries[0].presence).toBe('unknown');
        expect(unknown.liveStateAvailable).toBe(false);
    });

    it('reports camera states truthfully', () => {
        expect(build().entries[0].camera).toBe('on');
        expect(build({
            live: new Map([['lk-ana', live('Ana', [{ source: 'CAMERA', muted: true }])]]),
        }).entries[0].camera).toBe('off');
        expect(build({
            live: new Map([['lk-ana', live('Ana')]]),
        }).entries[0].camera).toBe('off');
        expect(build({ live: new Map() }).entries[0].camera).toBe('unknown');
    });

    it('keeps a tile without a database row dignified and anonymous', () => {
        const manifest = build({
            layout: layout([{ id: 'tp-stranger', column: 0, row: 0 }]),
            participants: [],
            live: new Map(),
        });
        expect(manifest.entries[0]).toMatchObject({
            tileId: 'tp-stranger',
            displayName: 'Attendee',
            handRaised: false,
            presence: 'reconnecting',
            camera: 'unknown',
        });
    });

    it('lists waiting hands without a tile separately, with tileId null', () => {
        const manifest = build({
            participants: [
                participant({ raisedAt: new Date('2026-08-04T12:00:00Z') }),
                participant({ identity: 'lk-beto', raisedAt: new Date('2026-08-04T12:01:00Z') }),
            ],
            live: new Map([
                ['lk-ana', live('Ana')],
                ['lk-beto', live('Beto')],
            ]),
        });
        expect(manifest.waitingHands).toEqual([
            { displayName: 'Ana', queuePosition: 1, tileId: 'tp-lk-ana' },
            { displayName: 'Beto', queuePosition: 2, tileId: null },
        ]);
    });

    it('exposes an empty layout as no overlay surface, with generic freshness', () => {
        const manifest = build({ layout: null });
        expect(manifest.layout).toBeNull();
        expect(manifest.tileFreshForSeconds).toBeNull();
        expect(manifest.entries).toEqual([]);
        // A waiting hand still surfaces textually without any grid.
        const withHand = build({
            layout: null,
            participants: [participant({ raisedAt: new Date('2026-08-04T12:00:00Z') })],
        });
        expect(withHand.waitingHands).toEqual([
            { displayName: 'Ana', queuePosition: 1, tileId: null },
        ]);
    });

    it('changes revision when semantic state changes, not otherwise', () => {
        const a = build();
        const same = build();
        const handUp = build({
            participants: [participant({ raisedAt: new Date('2026-08-04T12:00:00Z') })],
        });
        expect(a.revision).toBe(same.revision);
        expect(a.revision).not.toBe(handUp.revision);
    });

    it('orders queue positions across tiled and tile-less hands together', () => {
        const manifest = build({
            layout: layout([
                { id: 'tp-lk-ana', column: 0, row: 0 },
                { id: 'tp-lk-cele', column: 1, row: 0 },
            ]),
            participants: [
                participant({ identity: 'lk-cele', raisedAt: new Date('2026-08-04T12:02:00Z') }),
                participant({ identity: 'lk-beto', raisedAt: new Date('2026-08-04T12:01:00Z') }),
                participant({ identity: 'lk-ana', raisedAt: new Date('2026-08-04T12:00:00Z') }),
            ],
            live: new Map([
                ['lk-ana', live('Ana')],
                ['lk-beto', live('Beto')],
                ['lk-cele', live('Cele')],
            ]),
        });
        expect(manifest.entries[0]).toMatchObject({ tileId: 'tp-lk-ana', queuePosition: 1 });
        expect(manifest.entries[1]).toMatchObject({ tileId: 'tp-lk-cele', queuePosition: 3 });
        expect(manifest.waitingHands.map((hand) => hand.displayName)).toEqual(['Ana', 'Beto', 'Cele']);
    });
});
