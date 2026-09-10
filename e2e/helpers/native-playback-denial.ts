declare global {
    interface Window {
        allowFixturePlayback: () => void;
        nativePlaybackDenialAttempts: number;
    }
}

/** Browser init-script controlling only native media playback policy. */
export function denyNativePlayback(): void {
    let blocked = true;
    window.nativePlaybackDenialAttempts = 0;
    const play = HTMLMediaElement.prototype.play;
    const pause = HTMLMediaElement.prototype.pause;
    const autoplay = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'autoplay');
    if (!autoplay?.get || !autoplay.set) throw new Error('native autoplay descriptor unavailable');
    // LiveKit attachToElement sets autoplay BEFORE attaching the real stream.
    // Suppress that native policy path as well; never spoof paused/currentTime,
    // tracks, SDK readiness or AudioContext state. Keep the native getter.
    const guarded = new WeakSet<HTMLAudioElement>();
    Object.defineProperty(HTMLMediaElement.prototype, 'autoplay', {
        ...autoplay,
        set(value: boolean) {
            if (this instanceof HTMLAudioElement && !guarded.has(this)) {
                guarded.add(this);
                // WebKit can auto-start an attached MediaStream despite the
                // false autoplay property. Stop its REAL native play event,
                // including while detached; never manufacture paused evidence.
                this.addEventListener('play', () => { if (blocked) pause.call(this); });
            }
            autoplay.set!.call(this, this instanceof HTMLAudioElement && blocked ? false : value);
        },
    });
    HTMLMediaElement.prototype.play = function () {
        if (this instanceof HTMLAudioElement && blocked) {
            window.nativePlaybackDenialAttempts += 1;
            pause.call(this);
            return Promise.reject(new DOMException('E2E autoplay policy denial', 'NotAllowedError'));
        }
        return play.call(this);
    };
    window.allowFixturePlayback = () => { blocked = false; };
}
