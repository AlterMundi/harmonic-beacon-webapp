import { describe, expect, it } from 'vitest';

import { parseLiveKitTokenResponse } from '../livekit-token-response';

describe('LiveKit token response runtime configuration', () => {
    it('requires a token and a credential-free websocket endpoint', () => {
        expect(parseLiveKitTokenResponse({
            token: 'jwt',
            livekitUrl: 'wss://live.example.com/rtc',
        })).toEqual({ token: 'jwt', livekitUrl: 'wss://live.example.com/rtc' });

        for (const payload of [
            {},
            { token: 'jwt' },
            { token: '', livekitUrl: 'wss://live.example.com/rtc' },
            { token: 'jwt', livekitUrl: 'https://live.example.com/rtc' },
            { token: 'jwt', livekitUrl: 'wss://user:pass@live.example.com/rtc' },
            { token: 'jwt', livekitUrl: 'wss://live.example.com/rtc?credential=x' },
        ]) {
            expect(() => parseLiveKitTokenResponse(payload)).toThrow(/token response/);
        }
    });
});
