import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('environment-neutral application image', () => {
    it('delivers the allowlisted runtime endpoint with both token responses and clients consume it', () => {
        const bedRoute = read('src/app/api/livekit/token/route.ts');
        const stageRoute = read('src/app/api/scheduled-sessions/[id]/token/route.ts');
        const page = read('src/app/session/[id]/page.tsx');
        const audio = read('src/context/AudioContext.tsx');
        const server = read('src/lib/livekit-server.ts');

        for (const route of [bedRoute, stageRoute]) {
            expect(route).toContain('resolveLiveKitPublicUrl');
            expect(route).toContain('const livekitUrl = resolveLiveKitPublicUrl();');
            expect(route).toMatch(/\blivekitUrl,\n/);
            expect(route.indexOf('const livekitUrl = resolveLiveKitPublicUrl();'))
                .toBeLessThan(route.indexOf('finalizeRoomTokenIssue({'));
        }
        for (const client of [page, audio]) {
            expect(client).toContain('parseLiveKitTokenResponse');
            expect(client).toMatch(/room\.connect\(livekitUrl, token\)/);
            expect(client).not.toContain('NEXT_PUBLIC_LIVEKIT_URL');
        }
        expect(server).toContain('resolveLiveKitPublicUrl');
        expect(server).not.toContain('NEXT_PUBLIC_LIVEKIT_URL');
    });

    it('does not bake the environment endpoint into the app image', () => {
        const dockerfile = read('Dockerfile');
        const compose = read('docker-compose.yml');
        const staging = read('deploy/live-staging.compose.yml');

        expect(dockerfile).not.toContain('NEXT_PUBLIC_LIVEKIT_URL');
        expect(compose).not.toContain('NEXT_PUBLIC_LIVEKIT_URL');
        expect(staging).not.toContain('NEXT_PUBLIC_LIVEKIT_URL');
        expect(compose).toContain('LIVEKIT_PUBLIC_URL=${LIVEKIT_PUBLIC_URL:?required}');
        expect(compose).toContain('LIVEKIT_PUBLIC_URL_ALLOWLIST=${LIVEKIT_PUBLIC_URL_ALLOWLIST:?required}');
        expect(staging).toContain('LIVEKIT_PUBLIC_URL: ${LIVEKIT_PUBLIC_URL:?required}');
        expect(staging).toContain('LIVEKIT_PUBLIC_URL_ALLOWLIST: ${LIVEKIT_PUBLIC_URL_ALLOWLIST:?required}');
    });
});
