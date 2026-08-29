import { isIP } from 'node:net';

import maxmind from 'maxmind';

export function normalizedClientIp(value) {
    const first = String(value ?? '').split(',', 1)[0].trim();
    const normalized = first.startsWith('::ffff:') ? first.slice(7) : first;
    return isIP(normalized) ? normalized : null;
}

export function lookupGeo(reader, ip) {
    if (!reader || !ip) return { countryCode: 'unknown', regionCode: 'unknown' };
    try {
        const record = reader.get(ip);
        const country = record?.country?.iso_code ?? record?.country_code ?? record?.country?.isoCode;
        const region = record?.subdivisions?.[0]?.iso_code ?? record?.state?.iso_code ?? record?.region_code;
        return {
            countryCode: typeof country === 'string' && /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : 'unknown',
            regionCode: typeof region === 'string' && /^[A-Z0-9-]{1,16}$/i.test(region) ? region.toUpperCase() : 'unknown',
        };
    } catch {
        return { countryCode: 'unknown', regionCode: 'unknown' };
    }
}

export async function openGeoDatabase(path) {
    if (!path) return null;
    try { return await maxmind.open(path); } catch { return null; }
}
