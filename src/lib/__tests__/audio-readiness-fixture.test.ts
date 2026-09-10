// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { RECEIVED_AUDIO } from '../../../e2e/helpers/audio-readiness';

afterEach(() => { document.body.replaceChildren(); });

describe('received audio fixture selection', () => {
    it('excludes only the identified SDK iOS dummy, retaining two distinct real received tracks', () => {
        for (const id of ['beacon', 'stage', 'livekit-dummy-audio-el']) {
            const audio = document.createElement('audio');
            audio.id = id;
            Object.assign(audio, { srcObject: { getAudioTracks: () => [{ id: `track-${id}` }] } });
            document.body.append(audio);
        }
        const received = [...document.querySelectorAll<HTMLAudioElement>(RECEIVED_AUDIO)];
        expect(received.map(audio => audio.id)).toEqual(['beacon', 'stage']);
        expect(new Set(received.flatMap(audio => (audio.srcObject as MediaStream).getAudioTracks().map(track => track.id))).size).toBe(2);
    });
    it('keeps unexpected extra audio visible to exact-count assertions', () => {
        document.body.innerHTML = '<audio></audio><audio></audio><audio id="other-dummy"></audio>';
        expect(document.querySelectorAll(RECEIVED_AUDIO)).toHaveLength(3);
    });
});
