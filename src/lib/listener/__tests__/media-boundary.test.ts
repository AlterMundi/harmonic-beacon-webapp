import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MEDIA_FILE_SHA256 = {
    // Explicitly reviewed and re-pinned for #419 after Nico authorized the
    // stability vertical. The Listener now starts three minutes behind the
    // edge, retains the same bounded window in MSE plus an ephemeral segment
    // reservoir, preserves accepted bytes through network loss and retries the
    // same lease indefinitely with bounded backoff. Codec, bitrate, channel,
    // gain/fade, AudioContext, intro assets, quota, event and payment behavior
    // remain unchanged.
    'src/components/early-birds/ListenerPlayer.tsx': 'c4e3141c46add34b2ff90ba858ae1e806d4cf1a416280480adb84b9de483e43e',
    'src/lib/listener/playback-resilience.ts': '758c466216d2dfaef760665f28a35fdcefea167112fdc3ac96feb004dec7737f',
    'src/lib/listener/segment-reservoir.ts': '40176ee8ace849990d7d23ddc78531ad637d5a5c6ec1f11b5ed6935fa81ee497',
    'src/lib/early-birds/stream.ts': '40c5a17d27e8d6f820251d96dd33cd2bbbd83b164e50a212acf8fd0bb158c51c',
    'src/lib/early-birds/drop-ins.ts': '3b0d18c2c8548aa3ee917ece726cbca4b6d253ea3b4941a8424f8bcbfb8922e2',
    'src/app/api/early-birds/stream/lease/route.ts': 'ec0e8780387bc1f493eb33d13a2d90e01cfdb6d899fc6232e04f51aaf2dfc508',
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

    it('keeps the staging legacy API proxy block pinned to the disposable UI runtime', () => {
        const source = readFileSync(resolve(
            process.cwd(),
            'ops/early-birds-preview/nginx/earlybirds-staging.harmonicbeacon.com.conf.template',
        ), 'utf8');

        expect(sha256(nginxLocation(source, '/api/early-birds/')))
            .toBe('bd3892abf554b29be74ac2524d5f0a7b8a1c0d64dc81d10353f3daa0193380b8');
    });
});
