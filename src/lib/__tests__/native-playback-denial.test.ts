// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { denyNativePlayback } from '../../../e2e/helpers/native-playback-denial';

const autoplay = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'autoplay')!;
afterEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'autoplay', autoplay);
    vi.restoreAllMocks();
});

describe('native playback denial controls autoplay, not only explicit play promises', () => {
    it('pauses native play events on detached SDK audio elements until release (WebKit stream-autostart path)', () => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        denyNativePlayback();
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.autoplay = true; // a repeated attach must not add duplicate guards
        audio.dispatchEvent(new Event('play'));
        expect(pause).toHaveBeenCalledOnce();
        expect(pause.mock.contexts[0]).toBe(audio);
        window.allowFixturePlayback();
        audio.dispatchEvent(new Event('play'));
        expect(pause).toHaveBeenCalledOnce();
    });
    it('suppresses SDK autoplay property writes on audio while keeping native getters and video untouched, then releases to real play', async () => {
        const nativePlay = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        const nativePause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        denyNativePlayback();
        const audio = document.createElement('audio');
        const video = document.createElement('video');
        audio.autoplay = true; // SDK attachToElement writes this BEFORE srcObject.
        video.autoplay = true;
        expect(audio.autoplay).toBe(false);
        expect(video.autoplay).toBe(true);
        expect(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'autoplay')?.get).toBe(autoplay.get);
        await expect(audio.play()).rejects.toMatchObject({ name: 'NotAllowedError' });
        expect(nativePlay).not.toHaveBeenCalled();
        expect(nativePause).toHaveBeenCalledOnce();
        window.allowFixturePlayback();
        // Releasing the fault must not auto-play or fabricate success; only a
        // subsequent product gesture goes through to native play.
        expect(nativePlay).not.toHaveBeenCalled();
        expect(audio.autoplay).toBe(false);
        await expect(audio.play()).resolves.toBeUndefined();
        expect(nativePlay).toHaveBeenCalledOnce();
        expect(nativePlay.mock.contexts[0]).toBe(audio);
        audio.autoplay = true;
        expect(audio.autoplay).toBe(true);
    });
});
