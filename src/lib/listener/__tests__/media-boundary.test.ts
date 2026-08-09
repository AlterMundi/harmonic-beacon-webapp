import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MEDIA_FILE_SHA256 = {
    // The non-acoustic prepared-source race fix and transport presentation
    // were reviewed and re-pinned. Initial volume remains the explicitly
    // approved 70%; sources and signal processing are unchanged.
    'src/components/early-birds/ListenerPlayer.tsx': 'c0549198c599867c0b145c435d10fe6ec7816911a8b46ab0afc7717c6320be16',
    'src/lib/early-birds/stream.ts': '96a2d9fe798591833327631b59a73a5b2fc5ca06be7081945a0b07450970da84',
    'src/lib/early-birds/drop-ins.ts': '3b0d18c2c8548aa3ee917ece726cbca4b6d253ea3b4941a8424f8bcbfb8922e2',
    'src/app/api/early-birds/stream/lease/route.ts': 'ec0e8780387bc1f493eb33d13a2d90e01cfdb6d899fc6232e04f51aaf2dfc508',
    'src/app/api/early-birds/stream/manifest/route.ts': '56d8266fd8144c1e3ee13b168115f0a814a1da9f0a9f2db8b33e33facbba094e',
    'src/app/api/early-birds/stream/heartbeat/route.ts': '268ced6066e4a666f09286f2dc995a4085d9efd7a3f4ea4e983dc8055c9eab6b',
    'src/app/api/early-birds/drop-ins/[language]/route.ts': '545c6c04dc1532b939ae99f4e99e1d862d8b16e79ae94db184aef162154d5fa1',
} as const;

function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function nginxLocation(source: string, location: string): string {
    const escaped = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('/', '\\/');
    const match = source.match(new RegExp(`    location \\^~ ${escaped} \\{[\\s\\S]*?\\n    \\}`));
    if (!match) throw new Error(`Missing nginx media location ${location}`);
    return match[0];
}

describe('Listener namespace media boundary', () => {
    it('keeps every reviewed player and media handler byte-identical to the accepted quota baseline', () => {
        for (const [path, expected] of Object.entries(MEDIA_FILE_SHA256)) {
            expect(sha256(readFileSync(resolve(process.cwd(), path))), path).toBe(expected);
        }
    });

    it('keeps public stream and drop-in proxy blocks byte-identical', () => {
        const source = readFileSync(resolve(
            process.cwd(),
            'ops/early-birds-preview/nginx/listen.harmonicbeacon.com.conf.template',
        ), 'utf8');

        expect(sha256(nginxLocation(source, '/api/early-birds/stream/')))
            .toBe('877f937d145631a55f41b71fddb2142ad6f9b2833be1c57731eb772ed040fdb9');
        expect(sha256(nginxLocation(source, '/api/early-birds/drop-ins/')))
            .toBe('6738ce8a66d53fab790452e1b62bd74a3ff9439d7addc5c2a739cef00f8c17d4');
    });

    it('keeps the staging legacy API proxy block byte-identical', () => {
        const source = readFileSync(resolve(
            process.cwd(),
            'ops/early-birds-preview/nginx/earlybirds-staging.harmonicbeacon.com.conf.template',
        ), 'utf8');

        expect(sha256(nginxLocation(source, '/api/early-birds/')))
            .toBe('31f610cfd1d4d5778d6d3a2c10879790a5c2dcb8e39563738b2b39aa9cdc14c8');
    });
});
