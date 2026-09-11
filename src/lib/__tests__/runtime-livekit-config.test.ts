import { describe, expect, it } from 'vitest';

import { resolveLiveKitPublicUrl } from '../livekit-public-url';

describe('runtime LiveKit public URL contract', () => {
    it('accepts only the exact production wss endpoint from the runtime allowlist', () => {
        const env = {
            NODE_ENV: 'production',
            LIVEKIT_PUBLIC_URL: 'wss://live.harmonicbeacon.com/rtc',
            LIVEKIT_PUBLIC_URL_ALLOWLIST: 'wss://live.harmonicbeacon.com/rtc',
        };

        expect(resolveLiveKitPublicUrl(env)).toBe('wss://live.harmonicbeacon.com/rtc');
        for (const value of [
            'https://live.harmonicbeacon.com/rtc',
            'wss://user:pass@live.harmonicbeacon.com/rtc',
            'wss://live.harmonicbeacon.com/rtc?token=secret',
            'wss://live.harmonicbeacon.com/rtc#fragment',
            'wss://live.harmonicbeacon.com/rtc/extra',
            'wss://live.harmonicbeacon.com.evil.invalid/rtc',
        ]) {
            expect(() => resolveLiveKitPublicUrl({ ...env, LIVEKIT_PUBLIC_URL: value }))
                .toThrow(/LIVEKIT_PUBLIC_URL/);
        }
        expect(() => resolveLiveKitPublicUrl({
            NODE_ENV: 'production',
            LIVEKIT_PUBLIC_URL: env.LIVEKIT_PUBLIC_URL,
        })).toThrow(/ALLOWLIST/);
    });

    it('permits an explicitly configured loopback websocket only outside production', () => {
        const development = {
            NODE_ENV: 'test',
            LIVEKIT_PUBLIC_URL: 'ws://127.0.0.1:7880',
            LIVEKIT_PUBLIC_URL_ALLOWLIST: 'ws://127.0.0.1:7880',
        };
        expect(resolveLiveKitPublicUrl(development)).toBe('ws://127.0.0.1:7880/');
        expect(() => resolveLiveKitPublicUrl({ ...development, NODE_ENV: 'production' }))
            .toThrow(/wss/);
        expect(() => resolveLiveKitPublicUrl({
            ...development,
            LIVEKIT_PUBLIC_URL: 'ws://192.168.1.10:7880',
            LIVEKIT_PUBLIC_URL_ALLOWLIST: 'ws://192.168.1.10:7880',
        })).toThrow(/loopback/);
    });
});
