import { describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma }));

import {
    currentRegionalPresence,
    macroRegionFromCountry,
    presenceLevel,
    publicPresenceSnapshot,
    resolveListenerMacroRegion,
} from '../presence';

describe('anonymous Listener regional presence', () => {
    it('maps only to intentionally coarse macro-regions', () => {
        expect(macroRegionFromCountry('NA', 'MX')).toBe('LATIN_AMERICA');
        expect(macroRegionFromCountry('NA', 'US')).toBe('NORTH_AMERICA');
        expect(macroRegionFromCountry('SA', 'AR')).toBe('LATIN_AMERICA');
        expect(macroRegionFromCountry('EU', 'DE')).toBe('EUROPE');
        expect(macroRegionFromCountry('AS', 'JP')).toBe('ASIA');
        expect(macroRegionFromCountry(undefined, undefined)).toBe('UNKNOWN');
    });

    it('fails soft for unattributed, invalid, missing and failed GeoIP data', async () => {
        const factory = vi.fn();
        expect(await resolveListenerMacroRegion('unattributed', factory)).toBe('UNKNOWN');
        expect(factory).not.toHaveBeenCalled();
        await expect(resolveListenerMacroRegion('203.0.113.7', async () => null))
            .resolves.toBe('UNKNOWN');
        await expect(resolveListenerMacroRegion('203.0.113.7', async () => {
            throw new Error('database unavailable');
        })).resolves.toBe('UNKNOWN');
    });

    it('exposes bands rather than precise counts', () => {
        expect([0, 1, 2, 5, 16].map(presenceLevel)).toEqual([
            'none', 'trace', 'cluster', 'field', 'radiant',
        ]);
        const snapshot = publicPresenceSnapshot([
            { macroRegion: 'EUROPE', listeners: 19 },
            { macroRegion: 'LATIN_AMERICA', listeners: 3 },
        ], new Date('2026-08-07T20:00:00.000Z'));

        expect(snapshot).toMatchObject({
            schema: 'listener-presence.v1',
            observedAt: '2026-08-07T20:00:00.000Z',
            attribution: {
                label: 'IP Geolocation by DB-IP',
                href: 'https://db-ip.com',
                license: 'CC BY 4.0',
            },
        });
        expect(snapshot.regions.find(({ region }) => region === 'EUROPE')?.level).toBe('radiant');
        expect(snapshot.regions.find(({ region }) => region === 'LATIN_AMERICA')?.level).toBe('cluster');
        expect(JSON.stringify(snapshot)).not.toContain('19');
        expect(Object.keys(snapshot.regions[0] ?? {})).toEqual(['region', 'level']);
    });

    it('converts private grouped counts to the public schema', async () => {
        prisma.$queryRaw.mockResolvedValue([
            { macroRegion: 'OCEANIA', listeners: 1 },
        ]);
        const snapshot = await currentRegionalPresence(new Date('2026-08-07T20:00:00.000Z'));
        expect(snapshot.regions.find(({ region }) => region === 'OCEANIA')?.level).toBe('trace');
        expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    });
});
