import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MEDIA_FILE_SHA256 = {
    // Re-pinned after the accepted radio-keyboard accessibility-only refactor
    // in PR #252. Playback, media sources and signal processing were untouched.
    'src/components/early-birds/ListenerPlayer.tsx': 'fdf787402e94cc97a3b29b9291dc63e52b7a859d1ff9e9c505c99fe3aba720b1',
    'src/lib/early-birds/stream.ts': 'e386413874e5ad799e17607e2b030851cc7baadea48161191c7daecb45183bea',
    'src/lib/early-birds/drop-ins.ts': '3b0d18c2c8548aa3ee917ece726cbca4b6d253ea3b4941a8424f8bcbfb8922e2',
    'src/app/api/early-birds/stream/lease/route.ts': 'd858affc655c6df6607e76470508a59c3ebd442744bc12e5da334729fcb5d660',
    'src/app/api/early-birds/stream/manifest/route.ts': 'f149e9ed081579d75c0d588f7e6a75663b449c4baf28658418014a8e0c87a0de',
    'src/app/api/early-birds/stream/heartbeat/route.ts': '316a2690db50472b67bd0251d995e6d3375c710030ccf30e460e92d9ade1a407',
    'src/app/api/early-birds/drop-ins/[language]/route.ts': 'c905ba0ce68aa22448a2f41c9ed9563473dc097f0284e245421dae787cd30d94',
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
    it('keeps every player and media handler byte-identical to the accepted Phase 1 baseline', () => {
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
