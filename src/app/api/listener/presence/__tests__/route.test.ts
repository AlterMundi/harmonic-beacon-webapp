import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const currentRegionalPresence = vi.hoisted(() => vi.fn());
vi.mock('@/lib/listener/presence', () => ({ currentRegionalPresence }));

import { resetListenerPresenceRouteCacheForTests } from '@/lib/listener/presence-route-cache';
import { GET } from '../route';

const snapshot = {
    schema: 'listener-presence.v1' as const,
    observedAt: '2026-08-07T20:00:00.000Z',
    attribution: {
        label: 'IP Geolocation by DB-IP' as const,
        href: 'https://db-ip.com' as const,
        license: 'CC BY 4.0' as const,
    },
    regions: [{ region: 'EUROPE' as const, level: 'cluster' as const }],
};

beforeEach(() => {
    resetListenerPresenceRouteCacheForTests();
    currentRegionalPresence.mockResolvedValue(snapshot);
});

afterEach(() => vi.clearAllMocks());

describe('public Listener presence route', () => {
    it('returns only the coarse cacheable public snapshot', async () => {
        const response = await GET();
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('max-age=5');
        await expect(response.json()).resolves.toEqual(snapshot);
    });

    it('serves the last known public bands when storage is temporarily unavailable', async () => {
        await GET();
        currentRegionalPresence.mockRejectedValue(new Error('db down'));
        const response = await GET();
        expect(response.status).toBe(200);
        expect(response.headers.get('warning')).toContain('stale');
        await expect(response.json()).resolves.toEqual(snapshot);
    });

    it('fails explicitly instead of inventing an empty crowd without evidence', async () => {
        resetListenerPresenceRouteCacheForTests();
        currentRegionalPresence.mockRejectedValue(new Error('db down'));
        const response = await GET();
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store');
    });
});
