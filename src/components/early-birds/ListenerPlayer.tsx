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

class LeaseRequestError extends Error {
    constructor(readonly status: number) {
        super(`lease:${status}`);
    }
}

const DEVICE_STORAGE_KEY = 'hb_earlybird_device_id';
const DROP_PROGRESS_PREFIX = 'hb_earlybird_drop_progress_';
const RECOVERY_DELAYS_MS = [0, 1_000, 3_000] as const;
const STALL_RECOVERY_DELAY_MS = 1_000;
const LIVE_FADE_IN_MS = 3_000;
const TRANSPORT_FADE_OUT_MS = 650;

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
    const dropFadeFrame = useRef<number | null>(null);
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
    const [transportStopped, setTransportStopped] = useState(true);
    const [selectedDrop, setSelectedDrop] = useState<DropLanguage>(dropIns.en ? 'en' : 'es');
    const [dropProgress, setDropProgress] = useState({
        es: { current: 0, duration: 0 },
        en: { current: 0, duration: 0 },
    });
    const [volume, setVolume] = useState(1);
    const [volumeSupported, setVolumeSupported] = useState(true);
    const [livePrepared, setLivePrepared] = useState(false);
    const [livePreparing, setLivePreparing] = useState(true);
    const [devicePreparedByGesture, setDevicePreparedByGesture] = useState(false);
    const [prepareFailure, setPrepareFailure] = useState<'capacity' | 'unavailable' | null>(null);

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
        if (!response.ok) throw new LeaseRequestError(response.status);
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

    const cancelDropFade = useCallback(() => {
        if (dropFadeFrame.current !== null) {
            window.cancelAnimationFrame(dropFadeFrame.current);
            dropFadeFrame.current = null;
        }
    }, []);

    const armLiveFadeIn = useCallback(() => {
        const audio = liveAudio.current;
        cancelLiveFade();
        if (!audio) return;
        liveSuppressedForDrop.current = true;
        pendingLiveFade.current = true;
        audio.muted = true;
        if (volumeSupported) audio.volume = 0;
    }, [cancelLiveFade, volumeSupported]);

    const deferLiveFade = useCallback(() => {
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

    const pauseDropIns = useCallback((reset = false) => {
        cancelDropFade();
        for (const audio of [dropAudio.es.current, dropAudio.en.current]) {
            audio?.pause();
            if (audio && reset) audio.currentTime = 0;
            if (audio) audio.volume = volumeRef.current;
        }
        activeDrop.current = null;
        setPlayingDrop(null);
    }, [cancelDropFade, dropAudio.en, dropAudio.es]);

    const fadeOutAndPause = useCallback((
        audio: HTMLAudioElement,
        kind: 'live' | 'drop',
        onComplete: () => void,
    ) => {
        const frameRef = kind === 'live' ? liveFadeFrame : dropFadeFrame;
        if (kind === 'live') cancelLiveFade();
        else cancelDropFade();
        if (!volumeSupported || audio.paused || audio.volume <= 0) {
            audio.pause();
            audio.muted = false;
            audio.volume = volumeRef.current;
            onComplete();
            return;
        }
        const startedAt = performance.now();
        const startedVolume = audio.volume;
        const step = (now: number) => {
            const progress = Math.min(1, Math.max(0, (now - startedAt) / TRANSPORT_FADE_OUT_MS));
            audio.volume = startedVolume * Math.cos(progress * Math.PI / 2);
            if (progress < 1) {
                frameRef.current = window.requestAnimationFrame(step);
                return;
            }
            frameRef.current = null;
            audio.pause();
            audio.muted = false;
            audio.volume = volumeRef.current;
            onComplete();
        };
        frameRef.current = window.requestAnimationFrame(step);
    }, [cancelDropFade, cancelLiveFade, volumeSupported]);

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
                setPrepareFailure(null);
                return true;
            } catch (error) {
                livePreparedRef.current = false;
                setLivePrepared(false);
                setDevicePreparedByGesture(false);
                setPrepareFailure(error instanceof LeaseRequestError && error.status === 409
                    ? 'capacity'
                    : 'unavailable');
                return false;
            } finally {
                livePreparation.current = null;
                setLivePreparing(false);
            }
        })();
        livePreparation.current = pending;
        return pending;
    }, [attachManifest, requestLease]);

    const claimLiveSource = useCallback(async () => {
        if (livePreparing) return;
        setLivePreparing(true);
        updateLiveState('loading');
        try {
            // An explicit play intent may displace the account's oldest device.
            // It deliberately prepares only: iOS needs a second gesture once the
            // source exists so play() stays inside that gesture for every element.
            const grant = await requestLease('play');
            leaseId.current = grant.leaseId;
            manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
            await attachManifest(grant.stream.manifestUrl);
            setPrepareFailure(null);
            setDevicePreparedByGesture(true);
            updateLiveState('idle');
        } catch {
            livePreparedRef.current = false;
            setLivePrepared(false);
            setDevicePreparedByGesture(false);
            updateLiveState('error');
        } finally {
            setLivePreparing(false);
        }
    }, [attachManifest, livePreparing, requestLease, updateLiveState]);

    const revalidateIdlePreparedSource = useCallback(() => {
        if (!leaseId.current || livePreparation.current) return;
        setLivePreparing(true);
        livePreparedRef.current = false;
        setLivePrepared(false);
        setDevicePreparedByGesture(false);
        const pending = (async () => {
            try {
                const probe = await probeExistingLease();
                if (probe.kind === 'displaced' || probe.kind === 'denied') {
                    stopHls();
                    leaseId.current = null;
                    setPrepareFailure(probe.kind === 'displaced' ? 'capacity' : 'unavailable');
                    if (probe.kind === 'denied') updateLiveState('error');
                    return false;
                }
                if (probe.kind === 'retry') {
                    setPrepareFailure('unavailable');
                    return false;
                }
                if (probe.kind === 'active') {
                    manifestExpiresAt.current = Date.parse(probe.grant.stream.expiresAt);
                    if (probe.grant.stream.manifestUrl !== manifestUrl.current) {
                        await attachManifest(probe.grant.stream.manifestUrl);
                    } else {
                        livePreparedRef.current = true;
                        setLivePrepared(true);
                    }
                    setPrepareFailure(null);
                    return true;
                }

                leaseId.current = null;
                manifestUrl.current = null;
                manifestExpiresAt.current = 0;
                const grant = await requestLease('prepare');
                leaseId.current = grant.leaseId;
                manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
                await attachManifest(grant.stream.manifestUrl);
                setPrepareFailure(null);
                return true;
            } catch (error) {
                setPrepareFailure(error instanceof LeaseRequestError && error.status === 409
                    ? 'capacity'
                    : 'unavailable');
                return false;
            } finally {
                livePreparation.current = null;
                setLivePreparing(false);
            }
        })();
        livePreparation.current = pending;
    }, [attachManifest, probeExistingLease, requestLease, stopHls, updateLiveState]);

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

    const playLive = useCallback(async (forceRefresh = false, expectedGeneration = dropGeneration.current) => {
        if (!liveAudio.current || ['loading', 'recovering'].includes(liveStateRef.current)) return;
        wantsLivePlayback.current = true;
        cancelRecovery(true);
        pauseDropIns(true);
        armLiveFadeIn();
        updateLiveState('loading');
        const played = await attemptLivePlayback(forceRefresh);
        if (!wantsLivePlayback.current || expectedGeneration !== dropGeneration.current) return;
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
    }, [armLiveFadeIn, attemptLivePlayback, cancelRecovery, pauseDropIns, scheduleAutomaticRecovery, updateLiveState]);

    function playBeaconOnly() {
        dropGeneration.current += 1;
        if (!livePreparedRef.current) {
            void claimLiveSource();
            return;
        }
        setTransportStopped(false);
        void playLive(liveState === 'error' || liveState === 'displaced', dropGeneration.current);
    }

    function stopTransport() {
        dropGeneration.current += 1;
        setTransportStopped(true);
        wantsLivePlayback.current = false;
        cancelRecovery(true);
        pendingLiveFade.current = false;
        liveSuppressedForDrop.current = false;

        const selected = activeDrop.current ? dropAudio[activeDrop.current].current : null;
        activeDrop.current = null;
        setPlayingDrop(null);
        if (selected) {
            fadeOutAndPause(selected, 'drop', () => {
                selected.currentTime = 0;
                storeProgress(selectedDrop);
            });
        } else {
            pauseDropIns(true);
        }

        const live = liveAudio.current;
        if (!live) return;
        fadeOutAndPause(live, 'live', () => updateLiveState('paused'));
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
            if (document.visibilityState !== 'visible') {
                if (wantsLivePlayback.current) deferLiveFade();
                return;
            }
            if (!wantsLivePlayback.current) {
                revalidateIdlePreparedSource();
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
    }, [beginLiveFade, deferLiveFade, revalidateIdlePreparedSource, scheduleAutomaticRecovery]);

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
                livePreparedRef.current = false;
                setLivePrepared(false);
                setDevicePreparedByGesture(false);
                setPrepareFailure(probe.kind === 'displaced' ? 'capacity' : 'unavailable');
                updateLiveState(probe.kind === 'displaced' ? 'displaced' : 'error');
                return;
            }
            if (probe.kind === 'reacquire') {
                leaseId.current = null;
                livePreparedRef.current = false;
                setLivePrepared(false);
                setDevicePreparedByGesture(false);
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
        cancelDropFade();
        pendingLiveFade.current = false;
        activeDrop.current = null;
        liveAudio.current?.pause();
        stopHls();
    }, [cancelDropFade, cancelLiveFade, cancelRecovery, stopHls]);

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

    async function playWithIntro(language: DropLanguage) {
        const selected = dropAudio[language].current;
        if (!selected || !dropIns[language]) return;
        // The intro already contains the Beacon. Stop the live source before
        // the first intro frame so the two sources can never overlap.
        wantsLivePlayback.current = false;
        cancelRecovery(true);
        cancelLiveFade();
        pendingLiveFade.current = false;
        liveSuppressedForDrop.current = false;
        liveAudio.current?.pause();
        if (liveAudio.current) {
            liveAudio.current.muted = false;
            liveAudio.current.volume = volumeRef.current;
        }
        updateLiveState('paused');
        const other: DropLanguage = language === 'es' ? 'en' : 'es';
        dropAudio[other].current?.pause();
        cancelDropFade();
        selected.currentTime = 0;
        selected.volume = volumeRef.current;
        const generation = dropGeneration.current + 1;
        dropGeneration.current = generation;
        activeDrop.current = language;
        const isCurrent = () => dropGeneration.current === generation && activeDrop.current === language;
        try {
            await selected.play();
            if (!isCurrent()) return;
            setTransportStopped(false);
            setPlayingDrop(language);
        } catch {
            if (!isCurrent()) return;
            activeDrop.current = null;
            setTransportStopped(true);
            setPlayingDrop(null);
        }
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
        audio!.currentTime = 0;
        void playLive(false, dropGeneration.current);
    }

    const selectedProgress = dropProgress[selectedDrop];
    const selectedDropAvailable = Boolean(dropIns[selectedDrop]);
    const transportBusy = liveState === 'loading' || liveState === 'recovering' || livePreparing;
    const introActive = !transportStopped && playingDrop !== null;
    const beaconActive = !transportStopped && playingDrop === null && liveState === 'playing';
    const transportStatus = playingDrop
        ? copy.playingIntro
        : liveState === 'playing'
            ? copy.playingBeacon
            : liveState === 'recovering'
                ? copy.reconnecting
            : transportBusy
                ? copy.loading
                : copy.stopped;

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
                <div className="flex flex-col gap-5">
                    <div>
                        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-[var(--cyan)]">
                            <span className="h-2 w-2 animate-live-pulse rounded-full bg-[var(--cyan)]" aria-hidden="true" />
                            {copy.sharedPoint}
                        </div>
                        <h2 className="mt-3 font-serif text-4xl">{copy.heading}</h2>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-muted)]">{copy.subheading}</p>
                    </div>
                    <p role="status" className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                        {transportStatus}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
                        <label className="text-xs text-[var(--text-muted)]">
                            {copy.introSelection}
                            <select
                                value={selectedDrop}
                                onChange={(event) => setSelectedDrop(event.target.value as DropLanguage)}
                                disabled={playingDrop !== null}
                                className="mt-2 block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-3 text-sm text-[var(--paper)]"
                            >
                                {dropIns.en && <option value="en">{copy.english}</option>}
                                {dropIns.es && <option value="es">{copy.spanish}</option>}
                                {!dropIns.en && !dropIns.es && <option value="en">{copy.dropUnavailable}</option>}
                            </select>
                        </label>
                        <button
                            type="button"
                            onClick={() => {
                                if (!livePreparedRef.current) void claimLiveSource();
                                else void playWithIntro(selectedDrop);
                            }}
                            disabled={transportBusy || !selectedDropAvailable}
                            aria-pressed={introActive}
                            className="event-button event-button--primary listener-transport__button"
                        >
                            {copy.playWithIntro}
                        </button>
                        <button
                            type="button"
                            onClick={playBeaconOnly}
                            disabled={transportBusy}
                            aria-pressed={beaconActive}
                            className="event-button event-button--secondary listener-transport__button"
                        >
                            {copy.playBeaconOnly}
                        </button>
                        <button
                            type="button"
                            onClick={stopTransport}
                            disabled={transportBusy || (playingDrop === null && liveState !== 'playing')}
                            className="event-button event-button--secondary"
                        >
                            {copy.stop}
                        </button>
                    </div>
                </div>
                {(liveState === 'error' || liveState === 'displaced') && (
                    <p role="alert" className="mt-5 event-alert event-alert--danger">
                        {liveState === 'displaced' ? copy.displaced : copy.unavailable}
                    </p>
                )}
                {devicePreparedByGesture && liveState === 'idle' && (
                    <p role="status" className="mt-5 text-sm text-[var(--text-muted)]">
                        {copy.deviceReady}
                    </p>
                )}
                {!livePreparing && !livePrepared && liveState !== 'error' && (
                    <p role="status" className="mt-5 text-sm text-[var(--text-muted)]">
                        {prepareFailure === 'capacity' ? copy.deviceLimitClaim : copy.prepareHelp}
                    </p>
                )}
                <div className="hidden">
                    {(['es', 'en'] as const).map((language) => {
                        const title = language === 'es' ? copy.spanish : copy.english;
                        return (
                            <audio
                                key={language}
                                ref={dropAudio[language]}
                                src={dropIns[language] ?? undefined}
                                preload={language === selectedDrop ? 'auto' : 'metadata'}
                                onLoadedMetadata={() => restoreProgress(language)}
                                onTimeUpdate={() => storeProgress(language)}
                                onEnded={() => finishDropIn(language)}
                                aria-label={title}
                            />
                        );
                    })}
                </div>
                {selectedDropAvailable ? (
                    <article className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
                        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--gold)]">{selectedDrop.toUpperCase()}</p>
                        <h3 className="mt-2 text-base font-medium">{selectedDrop === 'es' ? copy.spanish : copy.english}</h3>
                        <label className="mt-4 block text-xs text-[var(--text-muted)]">
                            <span className="sr-only">{selectedDrop === 'es' ? copy.spanish : copy.english}</span>
                            <input
                                type="range"
                                aria-label={`${copy.introSelection}: ${selectedDrop === 'es' ? copy.spanish : copy.english}`}
                                min={0}
                                max={Math.max(selectedProgress.duration, 0)}
                                step={0.1}
                                value={Math.min(selectedProgress.current, selectedProgress.duration || 0)}
                                onChange={(event) => seekDropIn(selectedDrop, Number(event.target.value))}
                                className="w-full accent-[var(--gold)]"
                            />
                            <span className="mt-1 flex justify-between font-mono">
                                <span>{formatTime(selectedProgress.current)}</span>
                                <span>{formatTime(selectedProgress.duration)}</span>
                            </span>
                        </label>
                    </article>
                ) : (
                    <p className="mt-6 text-sm text-[var(--text-muted)]">{copy.dropUnavailable}</p>
                )}

                {volumeSupported && (
                    <label className="mt-6 block max-w-sm text-xs text-[var(--text-muted)]">
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
            </section>
        </div>
    );
}
