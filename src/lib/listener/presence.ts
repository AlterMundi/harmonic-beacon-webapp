import { isIP } from 'node:net';

import { Reader, type ReaderModel } from '@maxmind/geoip2-node';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID } from '@/lib/early-birds/stream';

export const LISTENER_MACRO_REGIONS = [
    'NORTH_AMERICA',
    'LATIN_AMERICA',
    'EUROPE',
    'AFRICA',
    'ASIA',
    'OCEANIA',
    'UNKNOWN',
] as const;

export type ListenerMacroRegion = typeof LISTENER_MACRO_REGIONS[number];
export type ListenerPresenceLevel = 'none' | 'trace' | 'cluster' | 'field' | 'radiant';

export type ListenerPresenceSnapshot = {
    schema: 'listener-presence.v1';
    observedAt: string;
    regions: Array<{
        region: ListenerMacroRegion;
        level: ListenerPresenceLevel;
    }>;
};

type RegionalCount = { macroRegion: ListenerMacroRegion; listeners: number };

const LATIN_AMERICAN_COUNTRIES = new Set([
    'AR', 'BO', 'BR', 'BZ', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'SV', 'GF',
    'GT', 'GY', 'HT', 'HN', 'MX', 'NI', 'PA', 'PY', 'PE', 'PR', 'SR', 'UY',
    'VE', 'AG', 'BS', 'BB', 'DM', 'GD', 'JM', 'KN', 'LC', 'VC', 'TT',
    'AW', 'BQ', 'CW', 'GP', 'MQ', 'MF', 'SX', 'TC', 'VI', 'VG', 'KY', 'MS',
]);

let geoReaderPromise: Promise<ReaderModel | null> | null = null;

async function configuredGeoReader(): Promise<ReaderModel | null> {
    const path = process.env.BEACON_LISTENER_GEOIP_DB_PATH?.trim();
    if (!path) return null;
    if (!geoReaderPromise) {
        geoReaderPromise = Reader.open(path).catch(() => null);
    }
    return geoReaderPromise;
}

export function macroRegionFromCountry(
    continentCode?: string,
    countryCode?: string,
): ListenerMacroRegion {
    const country = countryCode?.toUpperCase();
    if (country && LATIN_AMERICAN_COUNTRIES.has(country)) return 'LATIN_AMERICA';
    switch (continentCode?.toUpperCase()) {
        case 'NA': return 'NORTH_AMERICA';
        case 'SA': return 'LATIN_AMERICA';
        case 'EU': return 'EUROPE';
        case 'AF': return 'AFRICA';
        case 'AS': return 'ASIA';
        case 'OC': return 'OCEANIA';
        default: return 'UNKNOWN';
    }
}

export async function resolveListenerMacroRegion(
    address: string,
    readerFactory: () => Promise<ReaderModel | null> = configuredGeoReader,
): Promise<ListenerMacroRegion> {
    if (!isIP(address)) return 'UNKNOWN';
    try {
        const reader = await readerFactory();
        if (!reader) return 'UNKNOWN';
        const match = reader.country(address);
        return macroRegionFromCountry(match.continent?.code, match.country?.isoCode);
    } catch {
        return 'UNKNOWN';
    }
}

export function presenceLevel(listeners: number): ListenerPresenceLevel {
    if (listeners <= 0) return 'none';
    if (listeners === 1) return 'trace';
    if (listeners <= 4) return 'cluster';
    if (listeners <= 15) return 'field';
    return 'radiant';
}

export function publicPresenceSnapshot(
    rows: RegionalCount[],
    observedAt = new Date(),
): ListenerPresenceSnapshot {
    const counts = new Map(rows.map((row) => [row.macroRegion, row.listeners]));
    return {
        schema: 'listener-presence.v1',
        observedAt: observedAt.toISOString(),
        regions: LISTENER_MACRO_REGIONS.map((region) => ({
            region,
            level: presenceLevel(counts.get(region) ?? 0),
        })),
    };
}

export async function currentRegionalPresence(
    now = new Date(),
): Promise<ListenerPresenceSnapshot> {
    const freshAfter = new Date(now.getTime() - 4 * 60 * 1000);
    // Registered accounts count once even when using two leases. Anonymous
    // Free-for-All devices share a technical account, so their HMAC digest is
    // the ephemeral grouping key. Neither key leaves this private query.
    const rows = await prisma.$queryRaw<RegionalCount[]>(Prisma.sql`
        SELECT grouped."macroRegion", COUNT(*)::int AS "listeners"
        FROM (
            SELECT
                "macro_region"::text AS "macroRegion",
                CASE
                    WHEN "account_id" = ${EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID}
                    THEN "device_digest"
                    ELSE "account_id"
                END AS "listenerKey"
            FROM "early_bird_stream_leases"
            WHERE "presence" = 'LISTENING'::"ListenerPresenceState"
              AND "presence_updated_at" >= ${freshAfter}
              AND "expires_at" > ${now}
              AND "evicted_at" IS NULL
            GROUP BY "macro_region", "listenerKey"
        ) grouped
        GROUP BY grouped."macroRegion"
    `);
    return publicPresenceSnapshot(rows, now);
}

export function resetListenerGeoReaderForTests(): void {
    geoReaderPromise = null;
}
