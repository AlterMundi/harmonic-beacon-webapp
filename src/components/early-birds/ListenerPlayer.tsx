'use client';

import type Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdHomeCopy } from '@/lib/early-birds/copy';

type DropLanguage = 'es' | 'en';
type LiveState = 'idle' | 'loading' | 'recovering' | 'playing' | 'paused' | 'error' | 'displaced';
type LeasePayload = {
    leaseId: string;
    leaseExpiresAt: string;
    stream: { manifestUrl: string; expiresAt: string };
};
type HeartbeatPayload = Omit<LeasePayload, 'leaseId'>;
type LeaseProbeResult =
    | { kind: 'active'; grant: HeartbeatPayload }
    | { kind: 'reacquire' }
    | { kind: 'displaced' }
    | { kind: 'denied' }
    | { kind: 'retry' };

const DEVICE_STORAGE_KEY = 'hb_earlybird_device_id';
const DROP_PROGRESS_PREFIX = 'hb_earlybird_drop_progress_';
const RECOVERY_DELAYS_MS = [0, 1_000, 3_000] as const;
const STALL_RECOVERY_DELAY_MS = 1_000;
const LIVE_FADE_IN_MS = 3_000;

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

export function earlyBirdLeaseRecoveryDisposition(payload: unknown): 'displaced' | 'recoverable' {
    if (!payload || typeof payload !== 'object') return 'recoverable';
    return 'reason' in payload && payload.reason === 'displaced' ? 'displaced' : 'recoverable';
}

export function prefersNativeHls(
    audio: HTMLAudioElement,
    browser: Pick<Navigator, 'vendor'> = navigator,
): boolean {
    return browser.vendor === 'Apple Computer, Inc.'
        && Boolean(audio.canPlayType('application/vnd.apple.mpegurl'));
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
    const liveFadeFrame = useRef<number | null>(null);
    const pendingLiveFade = useRef(false);
    const activeDrop = useRef<DropLanguage | null>(null);
    const dropGeneration = useRef(0);
    const volumeRef = useRef(1);
    const livePreparedRef = useRef(false);
    const livePreparation = useRef<Promise<boolean> | null>(null);
    const manifestUrl = useRef<string | null>(null);
    const manifestExpiresAt = useRef(0);
    const leaseId = useRef<string | null>(null);
    const liveStateRef = useRef<LiveState>('idle');
    const wantsLivePlayback = useRef(false);
    const playbackAttemptRunning = useRef(false);
    const recoveryAttempts = useRef(0);
    const recoveryTimer = useRef<number | null>(null);
    const queuedRecoveryDelay = useRef<number | null>(null);
    const nativeSuspendObserved = useRef(false);
    const automaticRecovery = useRef<(initialDelayMs?: number) => void>(() => undefined);
    const deferLiveFadeForRecovery = useRef<() => void>(() => undefined);
    const [liveState, setLiveState] = useState<LiveState>('idle');
    const [playingDrop, setPlayingDrop] = useState<DropLanguage | null>(null);
    const [dropProgress, setDropProgress] = useState({
        es: { current: 0, duration: 0 },
        en: { current: 0, duration: 0 },
    });
    const [volume, setVolume] = useState(1);
    const [volumeSupported, setVolumeSupported] = useState(true);
    const [, setLivePrepared] = useState(false);
    const [livePreparing, setLivePreparing] = useState(true);

    const updateLiveState = useCallback((state: LiveState) => {
        liveStateRef.current = state;
        setLiveState(state);
    }, []);

    const cancelRecovery = useCallback((resetAttempts = false) => {
        if (recoveryTimer.current !== null) {
            window.clearTimeout(recoveryTimer.current);
            recoveryTimer.current = null;
        }
        queuedRecoveryDelay.current = null;
        if (resetAttempts) recoveryAttempts.current = 0;
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

        const nativeHlsSupported = Boolean(audio.canPlayType('application/vnd.apple.mpegurl'));
        if (prefersNativeHls(audio)) {
            audio.src = url;
            audio.load();
            livePreparedRef.current = true;
            setLivePrepared(true);
            return;
        }

        const HlsConstructor = (await import('hls.js')).default;
        if (!HlsConstructor.isSupported()) {
            if (nativeHlsSupported) {
                audio.src = url;
                audio.load();
                livePreparedRef.current = true;
                setLivePrepared(true);
                return;
            }
            throw new Error('HLS is not supported');
        }
        const instance = new HlsConstructor({
            lowLatencyMode: false,
            liveDurationInfinity: true,
            backBufferLength: 0,
        });
        instance.on(HlsConstructor.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            deferLiveFadeForRecovery.current();
            liveAudio.current?.pause();
            automaticRecovery.current(0);
        });
        instance.loadSource(url);
        instance.attachMedia(audio);
        hls.current = instance;
        livePreparedRef.current = true;
        setLivePrepared(true);
    }, [stopHls]);

    const requestLease = useCallback(async (intent: 'play' | 'prepare' = 'play'): Promise<LeasePayload> => {
        const deviceId = getOrCreateEarlyBirdDeviceId(window.localStorage);
        const response = await fetch('/api/early-birds/stream/lease', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceId, intent }),
        });
        if (!response.ok) throw new Error(`lease:${response.status}`);
        return response.json() as Promise<LeasePayload>;
    }, []);

    const probeExistingLease = useCallback(async (): Promise<LeaseProbeResult> => {
        if (!leaseId.current) return { kind: 'reacquire' };
        try {
            const response = await fetch('/api/early-birds/stream/heartbeat', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    leaseId: leaseId.current,
                    intent: wantsLivePlayback.current ? 'play' : 'prepare',
                }),
            });
            if (response.status === 410) {
                const payload = await response.json().catch(() => null) as { reason?: unknown } | null;
                return earlyBirdLeaseRecoveryDisposition(payload) === 'displaced'
                    ? { kind: 'displaced' }
                    : { kind: 'reacquire' };
            }
            if (response.status === 401 || response.status === 403) return { kind: 'denied' };
            if (!response.ok) return { kind: 'retry' };
            return { kind: 'active', grant: await response.json() as HeartbeatPayload };
        } catch {
            return { kind: 'retry' };
        }
    }, []);

    const cancelLiveFade = useCallback(() => {
        if (liveFadeFrame.current !== null) {
            window.cancelAnimationFrame(liveFadeFrame.current);
            liveFadeFrame.current = null;
        }
    }, []);

    const deferLiveFade = useCallback(() => {
        if (liveFadeFrame.current === null && !pendingLiveFade.current) return;
        cancelLiveFade();
        const audio = liveAudio.current;
        if (audio) audio.muted = true;
        liveSuppressedForDrop.current = true;
        pendingLiveFade.current = true;
    }, [cancelLiveFade]);

    useEffect(() => {
        deferLiveFadeForRecovery.current = deferLiveFade;
        return () => {
            deferLiveFadeForRecovery.current = () => undefined;
        };
    }, [deferLiveFade]);

    const beginLiveFade = useCallback(() => {
        if (!liveSuppressedForDrop.current) return;
        const audio = liveAudio.current;
        if (!audio || audio.paused || document.visibilityState !== 'visible') {
            pendingLiveFade.current = true;
            return;
        }
        cancelLiveFade();
        pendingLiveFade.current = false;
        audio.muted = false;
        if (volumeSupported && volumeRef.current > 0) {
            const startedAt = performance.now();
            audio.volume = 0;
            const step = (now: number) => {
                const progress = Math.min(1, Math.max(0, (now - startedAt) / LIVE_FADE_IN_MS));
                // Equal-power fade avoids an audible dip at the handoff. Read
                // the current control value so a mid-fade mute cannot be lost.
                audio.volume = volumeRef.current * Math.sin(progress * Math.PI / 2);
                if (progress < 1) {
                    liveFadeFrame.current = window.requestAnimationFrame(step);
                } else {
                    liveFadeFrame.current = null;
                }
            };
            liveFadeFrame.current = window.requestAnimationFrame(step);
        } else {
            // iOS does not expose writable per-element volume. Keep its native
            // level and perform a safe, non-overlapping unmute.
            audio.volume = volumeRef.current;
        }
        liveSuppressedForDrop.current = false;
    }, [cancelLiveFade, volumeSupported]);

    const restoreLiveOutput = useCallback((fadeIn = false) => {
        if (!liveSuppressedForDrop.current) return;
        if (fadeIn) {
            pendingLiveFade.current = true;
            beginLiveFade();
            return;
        }
        pendingLiveFade.current = false;
        cancelLiveFade();
        const audio = liveAudio.current;
        if (audio) {
            audio.muted = false;
            audio.volume = volumeRef.current;
        }
        liveSuppressedForDrop.current = false;
    }, [beginLiveFade, cancelLiveFade]);

    const pauseDropIns = useCallback(() => {
        dropAudio.es.current?.pause();
        dropAudio.en.current?.pause();
        dropGeneration.current += 1;
        activeDrop.current = null;
        setPlayingDrop(null);
        restoreLiveOutput();
    }, [dropAudio.en, dropAudio.es, restoreLiveOutput]);

    const attemptLivePlayback = useCallback(async (
        forceRefresh = false,
        verifyExistingLease = false,
    ): Promise<boolean> => {
        const audio = liveAudio.current;
        if (!audio || playbackAttemptRunning.current) return false;
        playbackAttemptRunning.current = true;
        try {
            let priorityRefreshed = false;
            // Reuse the source preparation started on mount instead of racing
            // it with a second lease request when a tester clicks immediately.
            if (!forceRefresh && livePreparation.current) await livePreparation.current;
            if (verifyExistingLease && leaseId.current) {
                const probe = await probeExistingLease();
                if (probe.kind === 'displaced' || probe.kind === 'denied') {
                    wantsLivePlayback.current = false;
                    audio.pause();
                    stopHls();
                    leaseId.current = null;
                    updateLiveState(probe.kind === 'displaced' ? 'displaced' : 'error');
                    return false;
                }
                if (probe.kind === 'retry') return false;
                if (probe.kind === 'reacquire') {
                    leaseId.current = null;
                    manifestUrl.current = null;
                    manifestExpiresAt.current = 0;
                } else {
                    manifestExpiresAt.current = Date.parse(probe.grant.stream.expiresAt);
                    await attachManifest(probe.grant.stream.manifestUrl);
                    forceRefresh = false;
                    priorityRefreshed = true;
                }
            }
            if (
                forceRefresh ||
                !leaseId.current ||
                !manifestUrl.current ||
                manifestExpiresAt.current <= Date.now() + 30_000
            ) {
                const grant = await requestLease('play');
                leaseId.current = grant.leaseId;
                manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
                if (forceRefresh || grant.stream.manifestUrl !== manifestUrl.current) {
                    await attachManifest(grant.stream.manifestUrl);
                }
                priorityRefreshed = true;
            } else if (!priorityRefreshed) {
                // Promote an iOS prewarm lease without delaying play() beyond
                // the user gesture. The stable same-device lease keeps the URL.
                void requestLease('play').then((grant) => {
                    leaseId.current = grant.leaseId;
                    manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
                }).catch(() => {
                    // The already-authorized source remains usable. Its active
                    // heartbeat retries priority promotion without interrupting audio.
                });
            }

            const liveSyncPosition = hls.current?.liveSyncPosition;
            if (typeof liveSyncPosition === 'number' && Number.isFinite(liveSyncPosition)) {
                audio.currentTime = liveSyncPosition;
            } else {
                seekNativeAudioToLiveEdge(audio);
            }
            await audio.play();
            return true;
        } catch {
            audio.pause();
            return false;
        } finally {
            playbackAttemptRunning.current = false;
        }
    }, [attachManifest, probeExistingLease, requestLease, stopHls, updateLiveState]);

    const prepareLiveSource = useCallback((forceRefresh = false): Promise<boolean> => {
        if (!forceRefresh && livePreparedRef.current && manifestExpiresAt.current > Date.now() + 30_000) {
            return Promise.resolve(true);
        }
        if (!forceRefresh && livePreparation.current) return livePreparation.current;
        setLivePreparing(true);
        const pending = (async () => {
            try {
                const grant = await requestLease('prepare');
                leaseId.current = grant.leaseId;
                manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
                await attachManifest(grant.stream.manifestUrl);
                return true;
            } catch {
                livePreparedRef.current = false;
                setLivePrepared(false);
                return false;
            } finally {
                livePreparation.current = null;
                setLivePreparing(false);
            }
        })();
        livePreparation.current = pending;
        return pending;
    }, [attachManifest, requestLease]);

    useEffect(() => {
        // Preparing (but not playing) the native element lets an intro click
        // invoke play() on both media elements inside the same iOS gesture.
        void prepareLiveSource();
    }, [prepareLiveSource]);

    const scheduleAutomaticRecovery = useCallback((initialDelayMs = 0) => {
        if (!wantsLivePlayback.current || liveStateRef.current === 'displaced') return;

        if (playbackAttemptRunning.current) {
            queuedRecoveryDelay.current = queuedRecoveryDelay.current === null
                ? Math.max(0, initialDelayMs)
                : Math.min(queuedRecoveryDelay.current, Math.max(0, initialDelayMs));
            updateLiveState('recovering');
            return;
        }
        if (recoveryTimer.current !== null) return;

        updateLiveState('recovering');
        const runAttempt = (delayMs: number) => {
            if (!wantsLivePlayback.current) return;
            if (recoveryAttempts.current >= RECOVERY_DELAYS_MS.length) {
                wantsLivePlayback.current = false;
                liveAudio.current?.pause();
                updateLiveState('error');
                return;
            }
            recoveryTimer.current = window.setTimeout(async () => {
                recoveryTimer.current = null;
                if (!wantsLivePlayback.current) return;
                recoveryAttempts.current += 1;
                const recovered = await attemptLivePlayback(true, true);
                if (!wantsLivePlayback.current) return;
                if (queuedRecoveryDelay.current !== null) {
                    const queuedDelay = queuedRecoveryDelay.current;
                    queuedRecoveryDelay.current = null;
                    runAttempt(queuedDelay);
                    return;
                }
                if (recovered) {
                    recoveryAttempts.current = 0;
                    updateLiveState('playing');
                    return;
                }
                runAttempt(RECOVERY_DELAYS_MS[recoveryAttempts.current] ?? 0);
            }, delayMs);
        };
        runAttempt(Math.max(0, initialDelayMs));
    }, [attemptLivePlayback, updateLiveState]);

    useEffect(() => {
        automaticRecovery.current = scheduleAutomaticRecovery;
        return () => {
            automaticRecovery.current = () => undefined;
        };
    }, [scheduleAutomaticRecovery]);

    const playLive = useCallback(async (forceRefresh = false) => {
        if (!liveAudio.current || ['loading', 'recovering'].includes(liveStateRef.current)) return;
        wantsLivePlayback.current = true;
        cancelRecovery(true);
        pauseDropIns();
        updateLiveState('loading');
        const played = await attemptLivePlayback(forceRefresh);
        if (!wantsLivePlayback.current) return;
        if (queuedRecoveryDelay.current !== null) {
            const queuedDelay = queuedRecoveryDelay.current;
            queuedRecoveryDelay.current = null;
            scheduleAutomaticRecovery(queuedDelay);
            return;
        }
        if (played) {
            updateLiveState('playing');
            return;
        }
        scheduleAutomaticRecovery(STALL_RECOVERY_DELAY_MS);
    }, [attemptLivePlayback, cancelRecovery, pauseDropIns, scheduleAutomaticRecovery, updateLiveState]);

    function toggleLive() {
        const audio = liveAudio.current;
        if (!audio) return;
        if (liveState === 'playing' || liveState === 'recovering') {
            wantsLivePlayback.current = false;
            cancelRecovery(true);
            audio.pause();
            audio.muted = false;
            liveSuppressedForDrop.current = false;
            updateLiveState('paused');
            return;
        }
        void playLive(liveState === 'error' || liveState === 'displaced');
    }

    const handleNativeInterruption = useCallback((kind: 'error' | 'stalled' | 'suspend') => {
        if (!wantsLivePlayback.current || !['playing', 'recovering'].includes(liveStateRef.current)) {
            return;
        }
        if (kind === 'suspend') {
            // `suspend` commonly means that the browser intentionally stopped
            // fetching enough buffered media. It is only supporting evidence;
            // stalled/error or a non-progressing page resume drives recovery.
            nativeSuspendObserved.current = true;
            return;
        }
        deferLiveFade();
        scheduleAutomaticRecovery(kind === 'error' ? 0 : STALL_RECOVERY_DELAY_MS);
    }, [deferLiveFade, scheduleAutomaticRecovery]);

    const handleNativePlaying = useCallback(() => {
        if (!wantsLivePlayback.current) return;
        nativeSuspendObserved.current = false;
        cancelRecovery(true);
        updateLiveState('playing');
        if (pendingLiveFade.current) beginLiveFade();
    }, [beginLiveFade, cancelRecovery, updateLiveState]);

    useEffect(() => {
        const probe = document.createElement('audio');
        probe.volume = 0.37;
        setVolumeSupported(Math.abs(probe.volume - 0.37) < 0.01);
    }, []);

    useEffect(() => {
        const all = [liveAudio.current, dropAudio.es.current, dropAudio.en.current];
        for (const audio of all) {
            if (audio && (audio !== liveAudio.current || liveFadeFrame.current === null)) audio.volume = volume;
        }
    }, [dropAudio.en, dropAudio.es, volume]);

    useEffect(() => {
        const recoverAfterResume = () => {
            if (!wantsLivePlayback.current) return;
            if (document.visibilityState !== 'visible') {
                deferLiveFade();
                return;
            }
            const pausedDuringPendingFade = pendingLiveFade.current
                && Boolean(liveAudio.current?.paused);
            if (pendingLiveFade.current && liveAudio.current && !liveAudio.current.paused) beginLiveFade();
            const leaseNearExpiry = manifestExpiresAt.current <= Date.now() + 30_000;
            const suspendedWithoutFutureData = nativeSuspendObserved.current
                && Boolean(liveAudio.current)
                && (liveAudio.current?.readyState ?? 0) < 3;
            if (liveStateRef.current === 'recovering'
                || leaseNearExpiry
                || suspendedWithoutFutureData
                || pausedDuringPendingFade) {
                scheduleAutomaticRecovery(0);
            }
        };
        document.addEventListener('visibilitychange', recoverAfterResume);
        window.addEventListener('online', recoverAfterResume);
        window.addEventListener('pageshow', recoverAfterResume);
        return () => {
            document.removeEventListener('visibilitychange', recoverAfterResume);
            window.removeEventListener('online', recoverAfterResume);
            window.removeEventListener('pageshow', recoverAfterResume);
        };
    }, [beginLiveFade, deferLiveFade, scheduleAutomaticRecovery]);

    useEffect(() => {
        const interval = window.setInterval(async () => {
            // The native element is prepared before the first gesture for iOS,
            // so its lease must also remain current while playback is idle.
            if (!leaseId.current) return;
            const probe = await probeExistingLease();
            if (probe.kind === 'displaced' || probe.kind === 'denied') {
                wantsLivePlayback.current = false;
                cancelRecovery(true);
                liveAudio.current?.pause();
                stopHls();
                leaseId.current = null;
                updateLiveState(probe.kind === 'displaced' ? 'displaced' : 'error');
                return;
            }
            if (probe.kind === 'reacquire') {
                leaseId.current = null;
                livePreparedRef.current = false;
                setLivePrepared(false);
                if (wantsLivePlayback.current) scheduleAutomaticRecovery(0);
                else void prepareLiveSource(true);
                return;
            }
            if (probe.kind === 'active') {
                manifestExpiresAt.current = Date.parse(probe.grant.stream.expiresAt);
                livePreparedRef.current = true;
                setLivePrepared(true);
            }
        }, 60_000);
        return () => window.clearInterval(interval);
    }, [cancelRecovery, prepareLiveSource, probeExistingLease, scheduleAutomaticRecovery, stopHls, updateLiveState]);

    useEffect(() => () => {
        wantsLivePlayback.current = false;
        cancelRecovery(true);
        cancelLiveFade();
        pendingLiveFade.current = false;
        activeDrop.current = null;
        liveAudio.current?.pause();
        stopHls();
    }, [cancelLiveFade, cancelRecovery, stopHls]);

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
            dropGeneration.current += 1;
            activeDrop.current = null;
            setPlayingDrop(null);
            return;
        }
        // The reviewed render is the intro. Start or preserve the shared Beacon
        // muted underneath it so the handoff lands on the current 24/7 timeline.
        if (liveAudio.current) {
            cancelLiveFade();
            liveAudio.current.muted = true;
            liveSuppressedForDrop.current = true;
        }
        const other: DropLanguage = language === 'es' ? 'en' : 'es';
        dropAudio[other].current?.pause();
        const generation = dropGeneration.current + 1;
        dropGeneration.current = generation;
        activeDrop.current = language;
        const isCurrent = () => dropGeneration.current === generation && activeDrop.current === language;
        try {
            // The source is pre-attached. Calling both play methods before the
            // first await preserves per-element user activation on iOS.
            let liveStarted: Promise<void> | null = null;
            if (!wantsLivePlayback.current && livePreparedRef.current && liveAudio.current) {
                wantsLivePlayback.current = true;
                cancelRecovery(true);
                updateLiveState('loading');
                void requestLease('play').then((grant) => {
                    leaseId.current = grant.leaseId;
                    manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
                }).catch(() => {
                    // Keep the prepared source playing and retry on heartbeat.
                });
                liveStarted = liveAudio.current.play();
            }
            const dropStarted = selected.play();
            if (!wantsLivePlayback.current) {
                wantsLivePlayback.current = true;
                cancelRecovery(true);
                updateLiveState('loading');
                void attemptLivePlayback().then((played) => {
                    if (!wantsLivePlayback.current) return;
                    if (played) updateLiveState('playing');
                    else scheduleAutomaticRecovery(STALL_RECOVERY_DELAY_MS);
                });
            }
            await dropStarted;
            if (!isCurrent()) return;
            if (liveStarted) {
                void liveStarted.then(() => updateLiveState('playing')).catch(() => {
                    scheduleAutomaticRecovery(STALL_RECOVERY_DELAY_MS);
                });
            }
            setPlayingDrop(language);
        } catch {
            if (!isCurrent()) return;
            activeDrop.current = null;
            setPlayingDrop(null);
            restoreLiveOutput();
        }
    }

    function restartDropIn(language: DropLanguage) {
        const audio = dropAudio[language].current;
        if (!audio || !dropIns[language]) return;
        audio.currentTime = 0;
        try {
            window.localStorage.removeItem(`${DROP_PROGRESS_PREFIX}${language}`);
        } catch {}
        setDropProgress((current) => ({
            ...current,
            [language]: { current: 0, duration: current[language].duration },
        }));
    }

    function seekDropIn(language: DropLanguage, value: number) {
        const audio = dropAudio[language].current;
        if (!audio) return;
        audio.currentTime = value;
        storeProgress(language);
    }

    function finishDropIn(language: DropLanguage) {
        const audio = dropAudio[language].current;
        const genuinelyEnded = Boolean(audio?.ended)
            || Boolean(audio && Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 0.25);
        if (activeDrop.current !== language || !genuinelyEnded) return;
        activeDrop.current = null;
        try {
            window.localStorage.removeItem(`${DROP_PROGRESS_PREFIX}${language}`);
        } catch {}
        setPlayingDrop(null);
        setDropProgress((current) => ({
            ...current,
            [language]: { current: 0, duration: current[language].duration },
        }));
        restoreLiveOutput(true);
    }

    const liveButton = liveState === 'loading'
        ? copy.loading
        : liveState === 'recovering'
            ? copy.reconnecting
            : liveState === 'playing'
                ? copy.pause
                : liveState === 'paused'
                    ? copy.resume
                    : copy.play;

    return (
        <div className="space-y-8">
            <audio
                ref={liveAudio}
                preload="auto"
                aria-label={copy.heading}
                onError={() => handleNativeInterruption('error')}
                onStalled={() => handleNativeInterruption('stalled')}
                onSuspend={() => handleNativeInterruption('suspend')}
                onPlaying={handleNativePlaying}
            />
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
                        disabled={liveState === 'loading' || livePreparing}
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
                                            <button
                                                type="button"
                                                onClick={() => toggleDropIn(language)}
                                                disabled={livePreparing}
                                                className="event-button event-button--secondary flex-1"
                                            >
                                                {playingDrop === language ? copy.pause : copy.dropPlay}
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
                        onChange={(event) => {
                            const next = Number(event.target.value);
                            volumeRef.current = next;
                            setVolume(next);
                        }}
                        className="mt-2 w-full accent-[var(--gold)]"
                    />
                </label>
            )}
        </div>
    );
}
