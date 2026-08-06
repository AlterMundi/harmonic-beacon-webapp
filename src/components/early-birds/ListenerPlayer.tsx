'use client';

import type Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdHomeCopy } from '@/lib/early-birds/copy';

type DropLanguage = 'es' | 'en';
type LiveState = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'displaced';
type LeasePayload = {
    leaseId: string;
    leaseExpiresAt: string;
    stream: { manifestUrl: string; expiresAt: string };
};

const DEVICE_STORAGE_KEY = 'hb_earlybird_device_id';
const DROP_PROGRESS_PREFIX = 'hb_earlybird_drop_progress_';

export function getOrCreateEarlyBirdDeviceId(storage: Storage): string {
    const existing = storage.getItem(DEVICE_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,200}$/.test(existing)) return existing;
    const generated = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    storage.setItem(DEVICE_STORAGE_KEY, generated);
    return generated;
}

export function seekNativeAudioToLiveEdge(audio: HTMLAudioElement): boolean {
    if (audio.seekable.length < 1) return false;
    const edge = audio.seekable.end(audio.seekable.length - 1);
    if (!Number.isFinite(edge)) return false;
    audio.currentTime = Math.max(0, edge - 0.25);
    return true;
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const rounded = Math.floor(seconds);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

export default function ListenerPlayer({
    dropIns,
}: {
    dropIns: { es: string | null; en: string | null };
}) {
    const { locale } = useLocale();
    const copy = earlyBirdHomeCopy[locale];
    const liveAudio = useRef<HTMLAudioElement>(null);
    const dropAudio = {
        es: useRef<HTMLAudioElement>(null),
        en: useRef<HTMLAudioElement>(null),
    };
    const hls = useRef<Hls | null>(null);
    const liveSuppressedForDrop = useRef(false);
    const manifestUrl = useRef<string | null>(null);
    const manifestExpiresAt = useRef(0);
    const leaseId = useRef<string | null>(null);
    const liveStateRef = useRef<LiveState>('idle');
    const [liveState, setLiveState] = useState<LiveState>('idle');
    const [playingDrop, setPlayingDrop] = useState<DropLanguage | null>(null);
    const [dropProgress, setDropProgress] = useState({
        es: { current: 0, duration: 0 },
        en: { current: 0, duration: 0 },
    });
    const [volume, setVolume] = useState(1);
    const [volumeSupported, setVolumeSupported] = useState(true);

    const updateLiveState = useCallback((state: LiveState) => {
        liveStateRef.current = state;
        setLiveState(state);
    }, []);

    const stopHls = useCallback(() => {
        hls.current?.destroy();
        hls.current = null;
    }, []);

    const attachManifest = useCallback(async (url: string) => {
        const audio = liveAudio.current;
        if (!audio) return;
        stopHls();
        manifestUrl.current = url;

        if (audio.canPlayType('application/vnd.apple.mpegurl')) {
            audio.src = url;
            audio.load();
            return;
        }

        const HlsConstructor = (await import('hls.js')).default;
        if (!HlsConstructor.isSupported()) throw new Error('HLS is not supported');
        const instance = new HlsConstructor({
            lowLatencyMode: false,
            liveDurationInfinity: true,
            backBufferLength: 0,
        });
        instance.on(HlsConstructor.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            updateLiveState('error');
            liveAudio.current?.pause();
        });
        instance.loadSource(url);
        instance.attachMedia(audio);
        hls.current = instance;
    }, [stopHls, updateLiveState]);

    const requestLease = useCallback(async (): Promise<LeasePayload> => {
        const deviceId = getOrCreateEarlyBirdDeviceId(window.localStorage);
        const response = await fetch('/api/early-birds/stream/lease', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceId }),
        });
        if (!response.ok) throw new Error(`lease:${response.status}`);
        return response.json() as Promise<LeasePayload>;
    }, []);

    const restoreLiveOutput = useCallback(() => {
        if (!liveSuppressedForDrop.current) return;
        if (liveAudio.current) liveAudio.current.muted = false;
        liveSuppressedForDrop.current = false;
    }, []);

    const pauseDropIns = useCallback(() => {
        dropAudio.es.current?.pause();
        dropAudio.en.current?.pause();
        setPlayingDrop(null);
        restoreLiveOutput();
    }, [dropAudio.en, dropAudio.es, restoreLiveOutput]);

    const playLive = useCallback(async (forceRefresh = false) => {
        const audio = liveAudio.current;
        if (!audio || liveStateRef.current === 'loading') return;
        pauseDropIns();
        updateLiveState('loading');
        try {
            if (
                forceRefresh ||
                !leaseId.current ||
                !manifestUrl.current ||
                manifestExpiresAt.current <= Date.now() + 30_000
            ) {
                const grant = await requestLease();
                leaseId.current = grant.leaseId;
                manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
                if (grant.stream.manifestUrl !== manifestUrl.current) {
                    await attachManifest(grant.stream.manifestUrl);
                }
            }

            const liveSyncPosition = hls.current?.liveSyncPosition;
            if (typeof liveSyncPosition === 'number' && Number.isFinite(liveSyncPosition)) {
                audio.currentTime = liveSyncPosition;
            } else {
                seekNativeAudioToLiveEdge(audio);
            }
            await audio.play();
            updateLiveState('playing');
        } catch {
            audio.pause();
            updateLiveState('error');
        }
    }, [attachManifest, pauseDropIns, requestLease, updateLiveState]);

    function toggleLive() {
        const audio = liveAudio.current;
        if (!audio) return;
        if (liveState === 'playing') {
            audio.pause();
            audio.muted = false;
            liveSuppressedForDrop.current = false;
            updateLiveState('paused');
            return;
        }
        void playLive(liveState === 'error' || liveState === 'displaced');
    }

    useEffect(() => {
        const probe = document.createElement('audio');
        probe.volume = 0.37;
        setVolumeSupported(Math.abs(probe.volume - 0.37) < 0.01);
    }, []);

    useEffect(() => {
        const all = [liveAudio.current, dropAudio.es.current, dropAudio.en.current];
        for (const audio of all) if (audio) audio.volume = volume;
    }, [dropAudio.en, dropAudio.es, volume]);

    useEffect(() => {
        const interval = window.setInterval(async () => {
            if (!leaseId.current || liveStateRef.current === 'idle') return;
            try {
                const response = await fetch('/api/early-birds/stream/heartbeat', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ leaseId: leaseId.current }),
                });
                if (response.status === 410) {
                    liveAudio.current?.pause();
                    stopHls();
                    leaseId.current = null;
                    updateLiveState('displaced');
                    return;
                }
                if (response.status === 403) {
                    liveAudio.current?.pause();
                    updateLiveState('error');
                    return;
                }
                if (!response.ok) return;
                const grant = await response.json() as Omit<LeasePayload, 'leaseId'>;
                manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
                // Keep the current media pipeline uninterrupted when the issuer
                // rotates equivalent signed URLs; a fatal HLS error reacquires.
            } catch {
                // Transient heartbeat loss does not interrupt already-buffered audio.
            }
        }, 60_000);
        return () => window.clearInterval(interval);
    }, [stopHls, updateLiveState]);

    useEffect(() => () => {
        liveAudio.current?.pause();
        stopHls();
    }, [stopHls]);

    function restoreProgress(language: DropLanguage) {
        const audio = dropAudio[language].current;
        if (!audio) return;
        let saved = 0;
        try {
            saved = Number(window.localStorage.getItem(`${DROP_PROGRESS_PREFIX}${language}`) ?? 0);
        } catch {
            saved = 0;
        }
        if (Number.isFinite(saved) && saved > 0 && saved < audio.duration - 2) {
            audio.currentTime = saved;
        }
        setDropProgress((current) => ({
            ...current,
            [language]: { current: audio.currentTime, duration: audio.duration || 0 },
        }));
    }

    function storeProgress(language: DropLanguage) {
        const audio = dropAudio[language].current;
        if (!audio) return;
        setDropProgress((current) => ({
            ...current,
            [language]: { current: audio.currentTime, duration: audio.duration || 0 },
        }));
        try {
            window.localStorage.setItem(`${DROP_PROGRESS_PREFIX}${language}`, String(audio.currentTime));
        } catch {
            // Progress is intentionally device-local and best effort.
        }
    }

    async function toggleDropIn(language: DropLanguage) {
        const selected = dropAudio[language].current;
        if (!selected || !dropIns[language]) return;
        if (playingDrop === language) {
            selected.pause();
            setPlayingDrop(null);
            restoreLiveOutput();
            return;
        }
        // A drop-in overlays the still-running shared Beacon. Muting preserves
        // its timeline, HLS source and lease; ending the drop only restores output.
        if (liveStateRef.current === 'playing' && liveAudio.current) {
            liveAudio.current.muted = true;
            liveSuppressedForDrop.current = true;
        }
        const other: DropLanguage = language === 'es' ? 'en' : 'es';
        dropAudio[other].current?.pause();
        try {
            await selected.play();
            setPlayingDrop(language);
        } catch {
            setPlayingDrop(null);
            restoreLiveOutput();
        }
    }

    function restartDropIn(language: DropLanguage) {
        const audio = dropAudio[language].current;
        if (!audio || !dropIns[language]) return;
        audio.currentTime = 0;
        void toggleDropIn(language);
    }

    function seekDropIn(language: DropLanguage, value: number) {
        const audio = dropAudio[language].current;
        if (!audio) return;
        audio.currentTime = value;
        storeProgress(language);
    }

    function finishDropIn(language: DropLanguage) {
        try {
            window.localStorage.removeItem(`${DROP_PROGRESS_PREFIX}${language}`);
        } catch {}
        setPlayingDrop(null);
        setDropProgress((current) => ({
            ...current,
            [language]: { current: 0, duration: current[language].duration },
        }));
        restoreLiveOutput();
    }

    const liveButton = liveState === 'loading'
        ? copy.loading
        : liveState === 'playing'
            ? copy.pause
            : liveState === 'paused'
                ? copy.resume
                : copy.play;

    return (
        <div className="space-y-8">
            <audio ref={liveAudio} preload="none" aria-label={copy.heading} />
            <section className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.04] p-6 sm:p-8">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-[var(--cyan)]">
                            <span className="h-2 w-2 animate-live-pulse rounded-full bg-[var(--cyan)]" aria-hidden="true" />
                            {copy.sharedPoint}
                        </div>
                        <h2 className="mt-3 font-serif text-4xl">{copy.heading}</h2>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-muted)]">{copy.subheading}</p>
                    </div>
                    <button
                        type="button"
                        onClick={toggleLive}
                        disabled={liveState === 'loading'}
                        className="event-button event-button--primary min-w-44"
                    >
                        {liveButton}
                    </button>
                </div>
                {(liveState === 'error' || liveState === 'displaced') && (
                    <p role="alert" className="mt-5 event-alert event-alert--danger">
                        {liveState === 'displaced' ? copy.displaced : copy.unavailable}
                    </p>
                )}
            </section>

            <section className="space-y-4">
                <h2 className="font-serif text-3xl">{copy.dropIns}</h2>
                <div className="grid gap-4 md:grid-cols-2">
                    {(['es', 'en'] as const).map((language) => {
                        const progress = dropProgress[language];
                        const available = Boolean(dropIns[language]);
                        const title = language === 'es' ? copy.spanish : copy.english;
                        return (
                            <article key={language} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
                                <audio
                                    ref={dropAudio[language]}
                                    src={dropIns[language] ?? undefined}
                                    preload="metadata"
                                    onLoadedMetadata={() => restoreProgress(language)}
                                    onTimeUpdate={() => storeProgress(language)}
                                    onEnded={() => finishDropIn(language)}
                                    aria-label={title}
                                />
                                <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--gold)]">{language.toUpperCase()}</p>
                                <h3 className="mt-2 text-base font-medium">{title}</h3>
                                {available ? (
                                    <>
                                        <div className="mt-5 flex gap-2">
                                            <button type="button" onClick={() => toggleDropIn(language)} className="event-button event-button--secondary flex-1">
                                                {playingDrop === language ? copy.pause : 'Play'}
                                            </button>
                                            <button type="button" onClick={() => restartDropIn(language)} className="event-button event-button--ghost">
                                                {copy.restart}
                                            </button>
                                        </div>
                                        <label className="mt-4 block text-xs text-[var(--text-muted)]">
                                            <span className="sr-only">{title}</span>
                                            <input
                                                type="range"
                                                min={0}
                                                max={Math.max(progress.duration, 0)}
                                                step={0.1}
                                                value={Math.min(progress.current, progress.duration || 0)}
                                                onChange={(event) => seekDropIn(language, Number(event.target.value))}
                                                className="w-full accent-[var(--gold)]"
                                            />
                                            <span className="mt-1 flex justify-between font-mono">
                                                <span>{formatTime(progress.current)}</span>
                                                <span>{formatTime(progress.duration)}</span>
                                            </span>
                                        </label>
                                    </>
                                ) : (
                                    <p className="mt-4 text-sm text-[var(--text-muted)]">{copy.dropUnavailable}</p>
                                )}
                            </article>
                        );
                    })}
                </div>
            </section>

            {volumeSupported && (
                <label className="block max-w-sm text-xs text-[var(--text-muted)]">
                    {copy.master}
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={volume}
                        onChange={(event) => setVolume(Number(event.target.value))}
                        className="mt-2 w-full accent-[var(--gold)]"
                    />
                </label>
            )}
        </div>
    );
}
