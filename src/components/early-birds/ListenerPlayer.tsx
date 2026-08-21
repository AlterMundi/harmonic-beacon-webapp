'use client';

import type Hls from 'hls.js';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
    DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
    ReactiveCampfireCanvas,
    ReactiveCampfireTuningPanel,
    resolveReactiveRenderPolicy,
    type ReactiveCampfireSettings,
} from '@/components/listener/reactive';
import { useLocale } from '@/context/LocaleContext';
import { earlyBirdHomeCopy } from '@/lib/early-birds/copy';
import {
    RemoteHarmonicAnalysisProvider,
    type HarmonicAnalysisFrame,
    type HarmonicAnalysisProvider,
} from '@/lib/listener/analysis';
import {
    LISTENER_PLAYBACK_WATCHDOG_INTERVAL_MS,
    ListenerPlaybackLivenessWatchdog,
    listenerPlaybackObservation,
    type ListenerPlaybackDiagnostic,
} from '@/lib/listener/playback-liveness';
import {
    LISTENER_BUFFER_EXHAUSTED_EPSILON_SECONDS,
    LISTENER_BUFFER_TARGET_SECONDS,
    listenerBufferedAheadSeconds,
    listenerHlsRecoveryAction,
    listenerRecoveryDelayMs,
    listenerTransportDiagnostic,
} from '@/lib/listener/playback-resilience';
import {
    createListenerReservoirLoader,
    ListenerSegmentReservoir,
} from '@/lib/listener/segment-reservoir';

import { deriveListenerPresentationPhase } from './listener-presentation';
import { ListenerTabIdentityCoordinator } from './listener-tab-identity';

export { getOrCreateEarlyBirdDeviceId } from './listener-tab-identity';

type DropLanguage = 'es' | 'en';
type PlaybackMode = 'intro' | 'beacon';
type LiveState = 'idle' | 'loading' | 'recovering' | 'playing' | 'paused' | 'error' | 'displaced';
type BackgroundSuspension = {
    source: 'beacon' | DropLanguage;
    rebuildHls: boolean;
};
type LeasePayload = {
    leaseId: string;
    leaseGeneration: number;
    presenceSequence: number;
    leaseExpiresAt: string;
    stream: { manifestUrl: string; expiresAt: string };
};
type HeartbeatPayload = Omit<LeasePayload, 'leaseId'> & {
    leaseGeneration: number;
    presenceSequence: number;
};
type LeaseProbeResult =
    | { kind: 'active'; grant: HeartbeatPayload }
    | { kind: 'superseded' }
    | { kind: 'reacquire' }
    | { kind: 'refresh-required' }
    | { kind: 'displaced' }
    | { kind: 'denied' }
    | { kind: 'retry' };

class LeaseRequestError extends Error {
    constructor(readonly status: number) {
        super(`lease:${status}`);
    }
}

const DROP_PROGRESS_PREFIX = 'hb_earlybird_drop_progress_';
const PLAYBACK_MODE_STORAGE_KEY = 'hb_listener_playback_mode';
const STALL_RECOVERY_DELAY_MS = 1_000;
const LIVE_FADE_IN_MS = 3_000;
const TRANSPORT_FADE_OUT_MS = 650;
const MEDIA_PLAY_ATTEMPT_TIMEOUT_MS = 8_000;
const HLS_REFILL_PROBE_TIMEOUT_MS = 2_000;
const DEFAULT_LISTENER_VOLUME = 0.7;
const LISTENER_STABILITY_DELAY_SECONDS = LISTENER_BUFFER_TARGET_SECONDS;

export const LISTENER_PLAYBACK_PRESENCE_EVENT = 'listener:playback-presence';
export const LISTENER_PLAYBACK_DIAGNOSTIC_EVENT = 'listener:playback-diagnostic';

function boundedDiagnosticToken(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
        ? value
        : null;
}

function listenerHlsForwardLoadPosition(audio: HTMLMediaElement | null): number {
    if (!audio || !Number.isFinite(audio.currentTime)) return -1;
    const currentTime = audio.currentTime;
    for (let index = 0; index < audio.buffered.length; index += 1) {
        try {
            const start = audio.buffered.start(index);
            const end = audio.buffered.end(index);
            if (
                Number.isFinite(start)
                && Number.isFinite(end)
                && currentTime >= start - 0.25
                && currentTime <= end + 0.25
            ) return Math.max(currentTime, end);
        } catch {
            return currentTime;
        }
    }
    return currentTime;
}

async function listenerManifestReachable(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), HLS_REFILL_PROBE_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { accept: 'application/vnd.apple.mpegurl' },
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            signal: controller.signal,
        });
        return response.ok;
    } catch {
        return false;
    } finally {
        window.clearTimeout(timeout);
    }
}

export function resolveListenerAnalysisFramesPerSecond({
    reducedMotion,
    saveData,
    minimal = false,
}: {
    reducedMotion: boolean;
    saveData: boolean;
    minimal?: boolean;
}): number {
    if (minimal) return 2;
    return resolveReactiveRenderPolicy({ reducedMotion, saveData }).conservative ? 2 : 4;
}

type LeaseCursor = {
    leaseId: string;
    leaseGeneration: number;
    presenceSequence: number;
};

/**
 * Lease responses can race recovery, page-resume and the initial prewarm.
 * A response is usable only when it cannot move either the request order or
 * the server-issued generation/sequence backwards.
 */
export function acceptsLeaseCursor(
    current: LeaseCursor | null,
    candidate: LeaseCursor,
    appliedRequestOrder: number,
    candidateRequestOrder: number,
): boolean {
    if (!current || current.leaseId !== candidate.leaseId) {
        return candidateRequestOrder >= appliedRequestOrder;
    }
    if (candidate.leaseGeneration !== current.leaseGeneration) {
        return candidate.leaseGeneration > current.leaseGeneration;
    }
    if (candidate.presenceSequence !== current.presenceSequence) {
        return candidate.presenceSequence > current.presenceSequence;
    }
    return candidateRequestOrder >= appliedRequestOrder;
}

export function nextPresenceSequence(
    currentPresence: 'idle' | 'listening',
    nextPresence: 'idle' | 'listening',
    currentSequence: number,
): number {
    return nextPresence === currentPresence ? currentSequence : currentSequence + 1;
}

// The Listener does not need low latency. Starting thirty six-second HLS
// segments behind the edge gives browsers the promised three minutes of
// network headroom while every fresh play still joins the current program.
export const LISTENER_HLS_BUFFER_CONFIG = {
    lowLatencyMode: false,
    liveDurationInfinity: true,
    initialLiveManifestSize: 31,
    liveSyncDurationCount: 30,
    liveMaxLatencyDurationCount: 48,
    liveSyncMode: 'buffered',
    startOnSegmentBoundary: true,
    maxBufferLength: LISTENER_BUFFER_TARGET_SECONDS,
    maxMaxBufferLength: 180,
    backBufferLength: 0,
} as const;

export function seekNativeAudioToLiveEdge(audio: HTMLAudioElement): boolean {
    if (audio.seekable.length < 1) return false;
    const rangeIndex = audio.seekable.length - 1;
    const start = audio.seekable.start(rangeIndex);
    const edge = audio.seekable.end(rangeIndex);
    if (!Number.isFinite(start) || !Number.isFinite(edge) || edge <= start) return false;
    // Listener has no low-latency requirement. Native HLS should use the same
    // three-minute safety margin as hls.js instead of sitting 250 ms from the
    // edge, where one delayed segment becomes an audible interruption.
    audio.currentTime = Math.max(start, edge - LISTENER_STABILITY_DELAY_SECONDS);
    return true;
}

async function playMediaWithTimeout(
    audio: HTMLMediaElement,
    timeoutMs = MEDIA_PLAY_ATTEMPT_TIMEOUT_MS,
): Promise<void> {
    let timeout: number | null = null;
    try {
        await Promise.race([
            audio.play(),
            new Promise<never>((_resolve, reject) => {
                timeout = window.setTimeout(
                    () => reject(new Error('media play timed out')),
                    timeoutMs,
                );
            }),
        ]);
    } finally {
        if (timeout !== null) window.clearTimeout(timeout);
    }
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

export function supportsReactiveListenerVisualization(
    browser: Pick<Navigator, 'vendor'>,
): boolean {
    // Remote frames never attach the media element to Web Audio. The argument
    // remains for a stable test seam while the staging experiment is open.
    return typeof browser.vendor === 'string';
}

export function nativeHlsProgramTimeMs(
    audio: Pick<HTMLMediaElement, 'currentTime'> & { getStartDate?: () => Date },
): number | null {
    if (!Number.isFinite(audio.currentTime) || typeof audio.getStartDate !== 'function') return null;
    try {
        const startDate = audio.getStartDate();
        const startMs = startDate?.getTime();
        return Number.isFinite(startMs) ? startMs + audio.currentTime * 1_000 : null;
    } catch {
        return null;
    }
}

export function hlsFragmentProgramTimeMs(
    mediaTimeSeconds: number,
    anchor: { mediaStartSeconds: number; programStartMs: number } | null,
): number | null {
    if (!anchor
        || !Number.isFinite(mediaTimeSeconds)
        || !Number.isFinite(anchor.mediaStartSeconds)
        || !Number.isFinite(anchor.programStartMs)) return null;
    return anchor.programStartMs + (mediaTimeSeconds - anchor.mediaStartSeconds) * 1_000;
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const rounded = Math.floor(seconds);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function preferredDropLanguage(
    locale: DropLanguage,
    spanishDropIn: string | null,
    englishDropIn: string | null,
): DropLanguage {
    if (locale === 'es' && spanishDropIn) return 'es';
    if (locale === 'en' && englishDropIn) return 'en';
    return englishDropIn ? 'en' : 'es';
}

type ListenerPlayerProps = {
    dropIns: { es: string | null; en: string | null };
    reactiveVisualizationAvailable?: boolean;
    reactiveVisualizationInitiallyEnabled?: boolean;
    reactiveFieldLabAvailable?: boolean;
};

type ListenerPlayerControllerProps = ListenerPlayerProps & {
    reactiveVisualizationEnabled: boolean;
    reactiveSettings: ReactiveCampfireSettings;
    onReactiveSettingsChange: (settings: ReactiveCampfireSettings) => void;
    onReactiveVisualizationChange: (enabled: boolean) => void;
    onReactiveVisualizationFailure: () => void;
    reactiveFallbackNotice: boolean;
};

const subscribeRuntimeVisualizationCapability = () => () => undefined;

function ListenerPlayerController({
    dropIns,
    reactiveVisualizationAvailable = false,
    reactiveFieldLabAvailable = false,
    reactiveVisualizationEnabled,
    reactiveSettings,
    onReactiveSettingsChange,
    onReactiveVisualizationChange,
    onReactiveVisualizationFailure,
    reactiveFallbackNotice,
}: ListenerPlayerControllerProps) {
    const { locale } = useLocale();
    const copy = earlyBirdHomeCopy[locale];
    const liveAudio = useRef<HTMLAudioElement>(null);
    const spanishDropAudio = useRef<HTMLAudioElement>(null);
    const englishDropAudio = useRef<HTMLAudioElement>(null);
    const dropAudio = useMemo(() => ({
        es: spanishDropAudio,
        en: englishDropAudio,
    }), []);
    const analysisProvider = useRef<HarmonicAnalysisProvider | null>(null);
    const analysisFrameListeners = useRef(new Set<(frame: HarmonicAnalysisFrame | null) => void>());
    const analysisFrameUnsubscribe = useRef<(() => void) | null>(null);
    const analysisStatusUnsubscribe = useRef<(() => void) | null>(null);
    const hls = useRef<Hls | null>(null);
    const hlsReservoir = useRef<ListenerSegmentReservoir | null>(null);
    const hlsProgramAnchor = useRef<{
        mediaStartSeconds: number;
        programStartMs: number;
    } | null>(null);
    const liveSuppressedForDrop = useRef(false);
    const liveFadeFrame = useRef<number | null>(null);
    const dropFadeFrame = useRef<number | null>(null);
    const pendingLiveFade = useRef(false);
    const activeDrop = useRef<DropLanguage | null>(null);
    const dropGeneration = useRef(0);
    const volumeRef = useRef(DEFAULT_LISTENER_VOLUME);
    const livePreparedRef = useRef(false);
    const livePreparation = useRef<Promise<boolean> | null>(null);
    const manifestUrl = useRef<string | null>(null);
    const manifestExpiresAt = useRef(0);
    const leaseId = useRef<string | null>(null);
    const leaseGeneration = useRef<number | null>(null);
    const presenceSequence = useRef(0);
    const leaseRequestOrder = useRef(0);
    const appliedLeaseRequestOrder = useRef(0);
    const tabIdentity = useRef<ListenerTabIdentityCoordinator | null>(null);
    const liveStateRef = useRef<LiveState>('idle');
    const wantsLivePlayback = useRef(false);
    const playbackAttemptRunning = useRef(false);
    const recoveryAttempts = useRef(0);
    const recoveryTimer = useRef<number | null>(null);
    const queuedRecoveryDelay = useRef<number | null>(null);
    const hlsRefillAttempts = useRef(0);
    const hlsRefillTimer = useRef<number | null>(null);
    const hlsRefillInstance = useRef<Hls | null>(null);
    const hlsRefillGeneration = useRef(0);
    const nativeSuspendObserved = useRef(false);
    const playbackWatchdog = useRef(new ListenerPlaybackLivenessWatchdog());
    const lastPlaybackAction = useRef('mount');
    const lastHlsSignal = useRef<ListenerPlaybackDiagnostic['hls']>({
        type: null,
        details: null,
        fatal: null,
    });
    const listenerPresence = useRef<'idle' | 'listening'>('idle');
    const automaticRecovery = useRef<(initialDelayMs?: number, action?: string) => void>(() => undefined);
    const deferLiveFadeForRecovery = useRef<() => void>(() => undefined);
    const backgroundSuspension = useRef<BackgroundSuspension | null>(null);
    const playbackLifecycleGeneration = useRef(0);
    const [liveState, setLiveState] = useState<LiveState>('idle');
    const [playingDrop, setPlayingDrop] = useState<DropLanguage | null>(null);
    const [transportStopped, setTransportStopped] = useState(true);
    const [transportPaused, setTransportPaused] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [selectedDrop, setSelectedDrop] = useState<DropLanguage>(() => (
        preferredDropLanguage(locale, dropIns.es, dropIns.en)
    ));
    const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(dropIns.en || dropIns.es ? 'intro' : 'beacon');
    const [dropProgress, setDropProgress] = useState({
        es: { current: 0, duration: 0 },
        en: { current: 0, duration: 0 },
    });
    const [volumeSupported, setVolumeSupported] = useState(true);
    const [livePrepared, setLivePrepared] = useState(false);
    const [livePreparing, setLivePreparing] = useState(true);
    const [devicePreparedByGesture, setDevicePreparedByGesture] = useState(false);
    const [prepareFailure, setPrepareFailure] = useState<'capacity' | 'unavailable' | null>(null);
    const [reactiveRendererAvailable, setReactiveRendererAvailable] = useState(true);

    const updateLiveState = useCallback((state: LiveState) => {
        liveStateRef.current = state;
        setLiveState(state);
    }, []);

    const subscribeReactiveFrames = useCallback((
        listener: (frame: HarmonicAnalysisFrame | null) => void,
    ) => {
        analysisFrameListeners.current.add(listener);
        return () => { analysisFrameListeners.current.delete(listener); };
    }, []);

    const currentBeaconProgramTimeMs = useCallback((): number | null => {
        const playingDate = hls.current?.playingDate;
        if (playingDate && Number.isFinite(playingDate.getTime())) {
            return playingDate.getTime();
        }
        const audio = liveAudio.current;
        if (!audio) return null;
        const fragmentTime = hlsFragmentProgramTimeMs(audio.currentTime, hlsProgramAnchor.current);
        if (fragmentTime !== null) {
            return fragmentTime;
        }
        const nativeTime = nativeHlsProgramTimeMs(audio);
        return nativeTime;
    }, []);

    const startReactiveAnalysis = useCallback((sourceId: string) => {
        if (!reactiveVisualizationEnabled || !reactiveRendererAvailable) return;
        let provider = analysisProvider.current;
        if (!provider) {
            const sources = [
                { id: 'beacon', kind: 'beacon' as const },
                ...(['es', 'en'] as const).flatMap((language) => {
                    return dropIns[language]
                        ? [{ id: `intro-${language}`, kind: 'intro' as const }]
                        : [];
                }),
            ];
            try {
                const reducedMotion = typeof window.matchMedia === 'function'
                    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                const saveData = Boolean((navigator as Navigator & {
                    connection?: { saveData?: boolean };
                }).connection?.saveData);
                provider = new RemoteHarmonicAnalysisProvider({
                    endpoint: '/api/listener/analysis/frame',
                    sources,
                    activeSourceId: sourceId,
                    getPlaybackProgramTimeMs: currentBeaconProgramTimeMs,
                    getLeaseCursor: () => (
                        leaseId.current && leaseGeneration.current !== null
                            ? { leaseId: leaseId.current, leaseGeneration: leaseGeneration.current }
                            : null
                    ),
                    framesPerSecond: resolveListenerAnalysisFramesPerSecond({
                        reducedMotion,
                        saveData,
                        minimal: reactiveSettings.visualizationMode === 'minimal-pulse',
                    }),
                });
            } catch {
                onReactiveVisualizationFailure();
                return;
            }
            analysisProvider.current = provider;
            analysisFrameUnsubscribe.current = provider.subscribe((frame) => {
                for (const listener of analysisFrameListeners.current) {
                    try { listener(frame); } catch { /* renderer isolation */ }
                }
            });
            analysisStatusUnsubscribe.current = provider.subscribeStatus((status) => {
                if (status.phase === 'error' && status.error?.code === 'ANALYSIS_FAILED') {
                    provider?.pauseAnalysis();
                    setReactiveRendererAvailable(false);
                }
            });
        }

        const selected = provider.setActiveSource(sourceId);
        if (!selected.ok) {
            onReactiveVisualizationFailure();
            return;
        }
        if (sourceId !== 'beacon') {
            for (const listener of analysisFrameListeners.current) {
                try { listener(null); } catch { /* renderer isolation */ }
            }
        }
        void provider.start().then((result) => {
            if (!result.ok) {
                onReactiveVisualizationFailure();
                return;
            }
            if (!wantsLivePlayback.current) provider?.pauseAnalysis();
        }).catch(() => onReactiveVisualizationFailure());
    }, [
        currentBeaconProgramTimeMs,
        dropIns,
        onReactiveVisualizationFailure,
        reactiveRendererAvailable,
        reactiveSettings.visualizationMode,
        reactiveVisualizationEnabled,
    ]);

    useEffect(() => {
        const provider = analysisProvider.current;
        if (!provider) return;
        const reducedMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const saveData = Boolean((navigator as Navigator & {
            connection?: { saveData?: boolean };
        }).connection?.saveData);
        provider.setFramesPerSecond(resolveListenerAnalysisFramesPerSecond({
            reducedMotion,
            saveData,
            minimal: reactiveSettings.visualizationMode === 'minimal-pulse',
        }));
    }, [reactiveSettings.visualizationMode]);

    useEffect(() => () => {
        analysisFrameUnsubscribe.current?.();
        analysisStatusUnsubscribe.current?.();
        analysisFrameUnsubscribe.current = null;
        analysisStatusUnsubscribe.current = null;
        analysisProvider.current?.stop();
        analysisProvider.current = null;
        analysisFrameListeners.current.clear();
    }, []);

    const cancelRecovery = useCallback((resetAttempts = false) => {
        if (recoveryTimer.current !== null) {
            window.clearTimeout(recoveryTimer.current);
            recoveryTimer.current = null;
        }
        queuedRecoveryDelay.current = null;
        if (resetAttempts) recoveryAttempts.current = 0;
    }, []);

    const cancelHlsRefill = useCallback((resetAttempts = true) => {
        hlsRefillGeneration.current += 1;
        if (hlsRefillTimer.current !== null) {
            window.clearTimeout(hlsRefillTimer.current);
            hlsRefillTimer.current = null;
        }
        hlsRefillInstance.current = null;
        if (resetAttempts) hlsRefillAttempts.current = 0;
    }, []);

    const scheduleHlsRefill = useCallback((instance: Hls, initialDelayMs = 0) => {
        if (!wantsLivePlayback.current || hls.current !== instance) return;
        if (hlsRefillTimer.current !== null && hlsRefillInstance.current === instance) return;
        cancelHlsRefill(false);
        hlsRefillInstance.current = instance;
        const refillGeneration = hlsRefillGeneration.current;

        const schedule = (delayMs: number) => {
            hlsRefillTimer.current = window.setTimeout(async () => {
                hlsRefillTimer.current = null;
                if (
                    !wantsLivePlayback.current
                    || hls.current !== instance
                    || hlsRefillInstance.current !== instance
                    || hlsRefillGeneration.current !== refillGeneration
                ) return;
                const probedManifestUrl = manifestUrl.current;
                const originReachable = probedManifestUrl
                    ? await listenerManifestReachable(probedManifestUrl)
                    : false;
                if (
                    !wantsLivePlayback.current
                    || hls.current !== instance
                    || hlsRefillInstance.current !== instance
                    || hlsRefillGeneration.current !== refillGeneration
                ) return;
                if (!originReachable || manifestUrl.current !== probedManifestUrl) {
                    hlsRefillAttempts.current = Math.min(
                        hlsRefillAttempts.current + 1,
                        1_000_000,
                    );
                    schedule(listenerRecoveryDelayMs(hlsRefillAttempts.current));
                    return;
                }
                lastPlaybackAction.current = 'hls-network-refill';
                try {
                    // Never touch hls.js merely because a request failed. Its
                    // timeline stays isolated while buffered audio is playing;
                    // only a successful origin probe may reset loader state.
                    instance.stopLoad();
                    hlsReservoir.current?.setOriginAllowed(true);
                    // Resume loading at the first missing forward byte without
                    // seeking the media element. Restarting at the sentinel or
                    // the currently playing fragment can rewind Firefox or feed
                    // overlapping media into its decoder while valid bytes are
                    // still buffered locally.
                    const currentAudio = liveAudio.current;
                    instance.startLoad(
                        listenerHlsForwardLoadPosition(currentAudio),
                        true,
                    );
                } catch {
                    // The bounded timer remains authoritative. A later retry or
                    // the media-clock recovery can rebuild after buffer exhaustion.
                }
                hlsRefillAttempts.current = Math.min(hlsRefillAttempts.current + 1, 1_000_000);
                schedule(listenerRecoveryDelayMs(hlsRefillAttempts.current));
            }, Math.max(0, delayMs));
        };
        schedule(initialDelayMs);
    }, [cancelHlsRefill]);

    const stopHls = useCallback(() => {
        cancelHlsRefill();
        hlsReservoir.current?.dispose();
        hlsReservoir.current = null;
        hls.current?.destroy();
        hls.current = null;
        hlsProgramAnchor.current = null;
    }, [cancelHlsRefill]);

    const attachManifest = useCallback(async (url: string) => {
        const audio = liveAudio.current;
        if (!audio) return;
        stopHls();
        lastHlsSignal.current = { type: null, details: null, fatal: null };
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
        const reservoir = new ListenerSegmentReservoir((snapshot) => {
            window.dispatchEvent(new CustomEvent(LISTENER_PLAYBACK_DIAGNOSTIC_EVENT, {
                detail: listenerTransportDiagnostic({
                    reason: 'reservoir-ready',
                    action: 'reservoir-filled',
                    observedAtMs: performance.now(),
                    bufferedAheadSeconds: listenerBufferedAheadSeconds(audio),
                    reservoirAheadSeconds: snapshot.retainedSeconds,
                    recoveryAttempt: 0,
                    hlsType: null,
                    hlsDetails: null,
                }),
            }));
        }, wantsLivePlayback.current);
        const ReservoirLoader = createListenerReservoirLoader(
            HlsConstructor.DefaultConfig.loader,
            reservoir,
        );
        hlsReservoir.current = reservoir;
        const instance = new HlsConstructor({
            ...LISTENER_HLS_BUFFER_CONFIG,
            loader: ReservoirLoader,
        });
        instance.on(HlsConstructor.Events.ERROR, (_event, data) => {
            lastHlsSignal.current = {
                type: boundedDiagnosticToken(data.type),
                details: boundedDiagnosticToken(data.details),
                fatal: Boolean(data.fatal),
            };
            const action = listenerHlsRecoveryAction(data.type);
            const bufferedAheadSeconds = listenerBufferedAheadSeconds(audio);
            const bufferedNetworkFailure = action === 'restart-network-load'
                && bufferedAheadSeconds > LISTENER_BUFFER_EXHAUSTED_EPSILON_SECONDS;
            if (bufferedNetworkFailure) {
                const enteringOfflineMode = reservoir.mayReachOrigin();
                reservoir.setOriginAllowed(false);
                // Freeze hls.js on its first (usually non-fatal) network error.
                // Restart it only against the in-memory reservoir so engines
                // with a small MediaSource window can keep appending retained
                // segments without retrying or seeking against the live origin.
                try {
                    instance.stopLoad();
                    if (enteringOfflineMode) {
                        instance.startLoad(listenerHlsForwardLoadPosition(audio), true);
                    }
                } catch {
                    // The probe loop remains authoritative and can retry later.
                }
                if (hlsRefillInstance.current !== instance) scheduleHlsRefill(instance);
            }
            if (!data.fatal) return;
            window.dispatchEvent(new CustomEvent(LISTENER_PLAYBACK_DIAGNOSTIC_EVENT, {
                detail: listenerTransportDiagnostic({
                    reason: 'hls-fatal',
                    action,
                    observedAtMs: performance.now(),
                    bufferedAheadSeconds,
                    recoveryAttempt: hlsRefillAttempts.current,
                    hlsType: lastHlsSignal.current.type,
                    hlsDetails: lastHlsSignal.current.details,
                }),
            }));
            if (action === 'restart-network-load') {
                // A manifest or segment failure does not invalidate bytes that
                // MediaSource already accepted. Keep the audio clock, fade,
                // presence and lease intact while hls.js refills in place.
                if (!bufferedNetworkFailure) scheduleHlsRefill(instance);
                return;
            }
            if (action === 'recover-media') {
                try {
                    instance.recoverMediaError();
                    return;
                } catch {
                    // Fall through to the same-lease destructive recovery only
                    // when hls.js cannot repair its decoder pipeline in place.
                }
            }
            deferLiveFadeForRecovery.current();
            liveAudio.current?.pause();
            automaticRecovery.current(0, 'hls-fatal');
        });
        const refillRecovered = () => {
            if (hlsRefillInstance.current !== instance) return;
            // Cached playlists/fragments prove only that the local reservoir is
            // usable. Keep probing until an actual origin request succeeds.
            if (!reservoir.mayReachOrigin()) return;
            const recoveryAttempt = hlsRefillAttempts.current;
            cancelHlsRefill();
            lastHlsSignal.current = { type: null, details: null, fatal: false };
            window.dispatchEvent(new CustomEvent(LISTENER_PLAYBACK_DIAGNOSTIC_EVENT, {
                detail: listenerTransportDiagnostic({
                    reason: 'hls-recovered',
                    action: 'refill-resumed',
                    observedAtMs: performance.now(),
                    bufferedAheadSeconds: listenerBufferedAheadSeconds(audio),
                    recoveryAttempt,
                    hlsType: null,
                    hlsDetails: null,
                }),
            }));
        };
        instance.on(HlsConstructor.Events.FRAG_LOADED, refillRecovered);
        instance.on(HlsConstructor.Events.LEVEL_LOADED, refillRecovered);
        instance.on(HlsConstructor.Events.FRAG_CHANGED, (_event, data) => {
            const programStartMs = data.frag.programDateTime;
            const mediaStartSeconds = data.frag.start;
            hlsProgramAnchor.current = typeof programStartMs === 'number'
                && Number.isFinite(programStartMs)
                && Number.isFinite(mediaStartSeconds)
                ? { programStartMs, mediaStartSeconds }
                : null;
        });
        instance.loadSource(url);
        instance.attachMedia(audio);
        hls.current = instance;
        livePreparedRef.current = true;
        setLivePrepared(true);
    }, [cancelHlsRefill, scheduleHlsRefill, stopHls]);

    const clearLeaseCursor = useCallback(() => {
        leaseId.current = null;
        leaseGeneration.current = null;
        presenceSequence.current = 0;
    }, []);

    const resolveTabIdentity = useCallback(() => {
        if (!tabIdentity.current) {
            tabIdentity.current = new ListenerTabIdentityCoordinator(window.sessionStorage);
        }
        return tabIdentity.current.resolve();
    }, []);

    const requestLease = useCallback(async (
        intent: 'play' | 'prepare' | 'claim' = 'play',
    ): Promise<LeasePayload> => {
        const requestOrder = ++leaseRequestOrder.current;
        // A tab is one connection. sessionStorage survives reload in that tab
        // without making two tabs collapse onto the same server-side lease.
        const deviceId = await resolveTabIdentity();
        const response = await fetch('/api/early-birds/stream/lease', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceId, intent }),
        });
        if (!response.ok) throw new LeaseRequestError(response.status);
        const grant = await response.json() as LeasePayload;
        if (!Number.isSafeInteger(grant.leaseGeneration) || grant.leaseGeneration < 1
            || !Number.isSafeInteger(grant.presenceSequence) || grant.presenceSequence < 0) {
            throw new LeaseRequestError(409);
        }
        const candidate = {
            leaseId: grant.leaseId,
            leaseGeneration: grant.leaseGeneration,
            presenceSequence: grant.presenceSequence,
        };
        const current = leaseId.current && leaseGeneration.current !== null
            ? {
                leaseId: leaseId.current,
                leaseGeneration: leaseGeneration.current,
                presenceSequence: presenceSequence.current,
            }
            : null;
        if (!acceptsLeaseCursor(
            current,
            candidate,
            appliedLeaseRequestOrder.current,
            requestOrder,
        )) {
            throw new LeaseRequestError(409);
        }
        appliedLeaseRequestOrder.current = Math.max(appliedLeaseRequestOrder.current, requestOrder);
        leaseId.current = candidate.leaseId;
        leaseGeneration.current = candidate.leaseGeneration;
        presenceSequence.current = candidate.presenceSequence;
        listenerPresence.current = intent === 'play' ? 'listening' : 'idle';
        return grant;
    }, [resolveTabIdentity]);

    useEffect(() => () => {
        tabIdentity.current?.close();
        tabIdentity.current = null;
    }, []);

    const probeExistingLease = useCallback(async (
        presence = listenerPresence.current,
    ): Promise<LeaseProbeResult> => {
        const currentLeaseId = leaseId.current;
        const currentGeneration = leaseGeneration.current;
        if (!currentLeaseId || currentGeneration === null) return { kind: 'reacquire' };
        const sentSequence = presenceSequence.current;
        try {
            const response = await fetch('/api/early-birds/stream/heartbeat', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    leaseId: currentLeaseId,
                    leaseGeneration: currentGeneration,
                    presenceSequence: sentSequence,
                    intent: wantsLivePlayback.current ? 'play' : 'prepare',
                    presence,
                }),
            });
            if (response.status === 410) {
                const payload = await response.json().catch(() => null) as { reason?: unknown } | null;
                return earlyBirdLeaseRecoveryDisposition(payload) === 'displaced'
                    ? { kind: 'displaced' }
                    : { kind: 'reacquire' };
            }
            if (response.status === 409) return { kind: 'refresh-required' };
            if (response.status === 401 || response.status === 403) return { kind: 'denied' };
            if (!response.ok) return { kind: 'retry' };
            const grant = await response.json() as HeartbeatPayload;
            if (!Number.isSafeInteger(grant.leaseGeneration) || grant.leaseGeneration < 1
                || !Number.isSafeInteger(grant.presenceSequence) || grant.presenceSequence < 0) {
                return { kind: 'refresh-required' };
            }
            const returnedGeneration = grant.leaseGeneration;
            const returnedSequence = grant.presenceSequence;
            if (
                leaseId.current !== currentLeaseId
                || leaseGeneration.current !== currentGeneration
                || returnedGeneration !== currentGeneration
                || returnedSequence < presenceSequence.current
            ) {
                return { kind: 'superseded' };
            }
            presenceSequence.current = returnedSequence;
            return { kind: 'active', grant };
        } catch {
            return { kind: 'retry' };
        }
    }, []);

    const reportPresence = useCallback((presence: 'idle' | 'listening') => {
        const previousPresence = listenerPresence.current;
        presenceSequence.current = nextPresenceSequence(
            previousPresence,
            presence,
            presenceSequence.current,
        );
        listenerPresence.current = presence;
        const currentLeaseId = leaseId.current;
        const currentGeneration = leaseGeneration.current;
        const currentSequence = presenceSequence.current;
        if (currentLeaseId && currentGeneration !== null) {
            const serialized = JSON.stringify({
                leaseId: currentLeaseId,
                leaseGeneration: currentGeneration,
                presenceSequence: currentSequence,
                intent: wantsLivePlayback.current ? 'play' : 'prepare',
                presence,
            });
            const body = new Blob([serialized], { type: 'application/json' });
            // sendBeacon survives pagehide and does not compete with playback or
            // recovery fetches. The duplicate ordinary heartbeat below is
            // idempotent and gives us an authoritative response immediately.
            navigator.sendBeacon?.('/api/early-birds/stream/heartbeat', body);

            void Promise.resolve(fetch('/api/early-birds/stream/heartbeat', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: serialized,
                keepalive: true,
            })).then(async (response) => {
                if (!response) return;
                // A later transition or replacement lease won this race.
                if (
                    leaseId.current !== currentLeaseId
                    || leaseGeneration.current !== currentGeneration
                    || presenceSequence.current !== currentSequence
                ) return;

                if (response.ok) {
                    const grant = await response.json() as HeartbeatPayload;
                    if (!Number.isSafeInteger(grant.leaseGeneration) || grant.leaseGeneration < 1
                        || !Number.isSafeInteger(grant.presenceSequence) || grant.presenceSequence < 0) {
                        wantsLivePlayback.current = false;
                        liveAudio.current?.pause();
                        stopHls();
                        clearLeaseCursor();
                        livePreparedRef.current = false;
                        setLivePrepared(false);
                        setDevicePreparedByGesture(false);
                        setPrepareFailure('unavailable');
                        updateLiveState('error');
                        return;
                    }
                    const returnedGeneration = grant.leaseGeneration;
                    const returnedSequence = grant.presenceSequence;
                    // A heartbeat never replaces a manifest or generation.
                    // Ignore reordered data rather than moving the cursor back.
                    if (
                        returnedGeneration === currentGeneration
                        && returnedSequence >= presenceSequence.current
                    ) {
                        presenceSequence.current = returnedSequence;
                        manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
                    }
                    return;
                }

                if (![401, 403, 409, 410].includes(response.status)) return;
                const payload = await response.json().catch(() => null) as { reason?: unknown } | null;
                const displaced = response.status === 410
                    && earlyBirdLeaseRecoveryDisposition(payload) === 'displaced';
                // The server rejected the exact cursor we still hold. Stop
                // immediately; a stale tab must not destructively reacquire.
                wantsLivePlayback.current = false;
                liveAudio.current?.pause();
                stopHls();
                clearLeaseCursor();
                livePreparedRef.current = false;
                setLivePrepared(false);
                setDevicePreparedByGesture(false);
                setPrepareFailure(displaced ? 'capacity' : 'unavailable');
                updateLiveState(displaced ? 'displaced' : 'error');
            }).catch(() => {
                // The beacon copy remains the best-effort pagehide delivery.
                // Periodic recovery is the bounded reliable retry.
            });
        }
        window.dispatchEvent(new CustomEvent(LISTENER_PLAYBACK_PRESENCE_EVENT, {
            detail: { presence },
        }));
    }, [clearLeaseCursor, stopHls, updateLiveState]);

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
        expectedLifecycleGeneration = playbackLifecycleGeneration.current,
    ): Promise<boolean> => {
        const audio = liveAudio.current;
        if (!audio || playbackAttemptRunning.current) return false;
        playbackAttemptRunning.current = true;
        try {
            // Reuse the source preparation started on mount instead of racing
            // it with a second lease request when a tester clicks immediately.
            if (!forceRefresh && livePreparation.current) await livePreparation.current;
            if (verifyExistingLease && leaseId.current) {
                const probe = await probeExistingLease();
                if (
                    probe.kind === 'displaced'
                    || probe.kind === 'denied'
                    || probe.kind === 'refresh-required'
                ) {
                    wantsLivePlayback.current = false;
                    audio.pause();
                    stopHls();
                    clearLeaseCursor();
                    updateLiveState(probe.kind === 'displaced' ? 'displaced' : 'error');
                    return false;
                }
                if (probe.kind === 'retry') return false;
                if (probe.kind === 'reacquire') {
                    clearLeaseCursor();
                    manifestUrl.current = null;
                    manifestExpiresAt.current = 0;
                } else if (probe.kind === 'active') {
                    manifestExpiresAt.current = Date.parse(probe.grant.stream.expiresAt);
                    if (forceRefresh || probe.grant.stream.manifestUrl !== manifestUrl.current) {
                        await attachManifest(probe.grant.stream.manifestUrl);
                    }
                    // A verified active lease has now been force-reattached or
                    // was already fresh. Never mint a duplicate lease merely
                    // to recover the media pipeline.
                    forceRefresh = false;
                } else {
                    // A newer request/presence report won the race. Keep its
                    // already attached source and do not apply the old reply.
                    forceRefresh = false;
                }
            }

            if (
                leaseId.current
                && !forceRefresh
                && manifestExpiresAt.current <= Date.now() + 30_000
            ) {
                const probe = await probeExistingLease();
                if (probe.kind === 'active') {
                    manifestExpiresAt.current = Date.parse(probe.grant.stream.expiresAt);
                    if (probe.grant.stream.manifestUrl !== manifestUrl.current) {
                        await attachManifest(probe.grant.stream.manifestUrl);
                    }
                } else if (probe.kind === 'reacquire') {
                    clearLeaseCursor();
                    manifestUrl.current = null;
                    manifestExpiresAt.current = 0;
                } else if (probe.kind === 'displaced' || probe.kind === 'refresh-required') {
                    wantsLivePlayback.current = false;
                    audio.pause();
                    stopHls();
                    clearLeaseCursor();
                    updateLiveState(probe.kind === 'displaced' ? 'displaced' : 'error');
                    return false;
                } else if (probe.kind === 'denied' || probe.kind === 'retry') {
                    return false;
                }
            }
            if (
                forceRefresh ||
                !leaseId.current ||
                !manifestUrl.current ||
                manifestExpiresAt.current <= Date.now() + 30_000
            ) {
                const grant = await requestLease('play');
                manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
                if (forceRefresh || grant.stream.manifestUrl !== manifestUrl.current) {
                    await attachManifest(grant.stream.manifestUrl);
                }
            }

            if (
                expectedLifecycleGeneration !== playbackLifecycleGeneration.current
                || !wantsLivePlayback.current
                || document.visibilityState !== 'visible'
            ) return false;
            const liveSyncPosition = hls.current?.liveSyncPosition;
            if (typeof liveSyncPosition === 'number' && Number.isFinite(liveSyncPosition)) {
                audio.currentTime = liveSyncPosition;
            } else {
                seekNativeAudioToLiveEdge(audio);
            }
            // Chromium can leave play() pending forever after an exhausted
            // MediaSource. Bound one attempt so the same-lease retry loop can
            // rebuild/refill once connectivity returns instead of deadlocking.
            await playMediaWithTimeout(audio);
            if (
                expectedLifecycleGeneration !== playbackLifecycleGeneration.current
                || !wantsLivePlayback.current
                || document.visibilityState !== 'visible'
            ) {
                audio.pause();
                return false;
            }
            return true;
        } catch {
            audio.pause();
            return false;
        } finally {
            playbackAttemptRunning.current = false;
        }
    }, [attachManifest, clearLeaseCursor, probeExistingLease, requestLease, stopHls, updateLiveState]);

    const prepareLiveSource = useCallback((forceRefresh = false): Promise<boolean> => {
        if (!forceRefresh && livePreparedRef.current && manifestExpiresAt.current > Date.now() + 30_000) {
            return Promise.resolve(true);
        }
        if (!forceRefresh && livePreparation.current) return livePreparation.current;
        setLivePreparing(true);
        const pending = (async () => {
            try {
                const grant = await requestLease('prepare');
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

    const claimLiveSource = useCallback((): Promise<boolean> => {
        if (livePreparation.current) return livePreparation.current;
        setLivePreparing(true);
        updateLiveState('loading');
        const pending = (async () => {
            try {
                // An explicit claim may displace the account's oldest device.
                // It deliberately prepares only: iOS needs a second gesture once the
                // source exists so play() stays inside that gesture for every element.
                const grant = await requestLease('claim');
                manifestExpiresAt.current = Date.parse(grant.stream.expiresAt);
                await attachManifest(grant.stream.manifestUrl);
                setPrepareFailure(null);
                setDevicePreparedByGesture(true);
                updateLiveState('idle');
                return true;
            } catch {
                livePreparedRef.current = false;
                setLivePrepared(false);
                setDevicePreparedByGesture(false);
                updateLiveState('error');
                return false;
            } finally {
                livePreparation.current = null;
                setLivePreparing(false);
            }
        })();
        livePreparation.current = pending;
        return pending;
    }, [attachManifest, requestLease, updateLiveState]);

    const revalidateIdlePreparedSource = useCallback(() => {
        if (!leaseId.current || livePreparation.current) return;
        setLivePreparing(true);
        // Keep the already attached source usable while its lease is checked.
        // Clearing it here created a narrow race where a visible Listen button
        // performed only a claim and produced no sound.
        const pending = (async () => {
            try {
                const probe = await probeExistingLease();
                if (
                    probe.kind === 'displaced'
                    || probe.kind === 'denied'
                    || probe.kind === 'refresh-required'
                ) {
                    stopHls();
                    clearLeaseCursor();
                    livePreparedRef.current = false;
                    setLivePrepared(false);
                    setDevicePreparedByGesture(false);
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
                if (probe.kind === 'superseded') {
                    livePreparedRef.current = true;
                    setLivePrepared(true);
                    setPrepareFailure(null);
                    return true;
                }

                stopHls();
                clearLeaseCursor();
                manifestUrl.current = null;
                manifestExpiresAt.current = 0;
                livePreparedRef.current = false;
                setLivePrepared(false);
                setDevicePreparedByGesture(false);
                const grant = await requestLease('prepare');
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
    }, [attachManifest, clearLeaseCursor, probeExistingLease, requestLease, stopHls, updateLiveState]);

    useEffect(() => {
        // Preparing (but not playing) the native element lets an intro click
        // invoke play() on both media elements inside the same iOS gesture.
        void prepareLiveSource();
    }, [prepareLiveSource]);

    useEffect(() => {
        try {
            const saved = window.localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY);
            if (saved === 'beacon') setPlaybackMode('beacon');
            if (saved === 'intro' && (dropIns.en || dropIns.es)) setPlaybackMode('intro');
        } catch {
            // The mode preference is device-local and best effort.
        }
    }, [dropIns.en, dropIns.es]);

    const scheduleAutomaticRecovery = useCallback((
        initialDelayMs = 0,
        action = 'automatic-recovery',
    ) => {
        if (!wantsLivePlayback.current || liveStateRef.current === 'displaced') return;

        lastPlaybackAction.current = action;

        if (playbackAttemptRunning.current) {
            queuedRecoveryDelay.current = queuedRecoveryDelay.current === null
                ? Math.max(0, initialDelayMs)
                : Math.min(queuedRecoveryDelay.current, Math.max(0, initialDelayMs));
            updateLiveState('recovering');
            return;
        }
        if (recoveryTimer.current !== null) return;

        const runAttempt = (delayMs: number) => {
            if (!wantsLivePlayback.current) return;
            recoveryTimer.current = window.setTimeout(async () => {
                recoveryTimer.current = null;
                if (!wantsLivePlayback.current) return;
                updateLiveState('recovering');
                recoveryAttempts.current = Math.min(recoveryAttempts.current + 1, 1_000_000);
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
                    reportPresence('listening');
                    updateLiveState('playing');
                    return;
                }
                runAttempt(listenerRecoveryDelayMs(recoveryAttempts.current));
            }, delayMs);
        };
        runAttempt(Math.max(0, initialDelayMs));
    }, [attemptLivePlayback, reportPresence, updateLiveState]);

    useEffect(() => {
        const interval = window.setInterval(() => {
            const audio = liveAudio.current;
            const eligible = Boolean(audio)
                && wantsLivePlayback.current
                && activeDrop.current === null
                && liveStateRef.current === 'playing'
                && document.visibilityState === 'visible';
            if (!audio || !eligible) {
                playbackWatchdog.current.reset();
                return;
            }

            const diagnostic = playbackWatchdog.current.observe(listenerPlaybackObservation({
                audio,
                observedAtMs: performance.now(),
                lastAction: lastPlaybackAction.current,
                leaseGeneration: leaseGeneration.current,
                presenceSequence: presenceSequence.current,
                hlsSignal: lastHlsSignal.current,
                visibility: document.visibilityState,
            }));
            if (!diagnostic) return;

            playbackWatchdog.current.reset();
            lastPlaybackAction.current = 'watchdog-recovery';
            // The object is deliberately bounded and contains no account,
            // lease ID, token, URL, cookie, IP or device fingerprint.
            console.warn('[listener] media-clock recovery', diagnostic);
            window.dispatchEvent(new CustomEvent(LISTENER_PLAYBACK_DIAGNOSTIC_EVENT, {
                detail: diagnostic,
            }));
            reportPresence('idle');
            deferLiveFade();
            const networkRecoveryInstance = lastHlsSignal.current.type === 'networkError'
                ? hls.current
                : null;
            if (networkRecoveryInstance) {
                // An exhausted MediaSource is not permission to destroy the
                // media timeline while the origin is still unreachable. The
                // refill probe owns this state: it leaves currentTime intact,
                // retries with bounded backoff and restarts the same hls.js
                // instance only after a real manifest succeeds.
                updateLiveState('recovering');
                if (hlsRefillInstance.current !== networkRecoveryInstance) {
                    scheduleHlsRefill(networkRecoveryInstance, 0);
                }
                return;
            }
            scheduleAutomaticRecovery(0, 'watchdog-recovery');
        }, LISTENER_PLAYBACK_WATCHDOG_INTERVAL_MS);
        return () => window.clearInterval(interval);
    }, [
        deferLiveFade,
        reportPresence,
        scheduleAutomaticRecovery,
        scheduleHlsRefill,
        updateLiveState,
    ]);

    useEffect(() => {
        automaticRecovery.current = scheduleAutomaticRecovery;
        return () => {
            automaticRecovery.current = () => undefined;
        };
    }, [scheduleAutomaticRecovery]);

    const playLive = useCallback(async (forceRefresh = false, expectedGeneration = dropGeneration.current) => {
        if (!liveAudio.current || ['loading', 'recovering'].includes(liveStateRef.current)) return;
        wantsLivePlayback.current = true;
        hlsReservoir.current?.enable();
        cancelRecovery(true);
        pauseDropIns(true);
        armLiveFadeIn();
        updateLiveState('loading');
        const played = await attemptLivePlayback(forceRefresh);
        if (!wantsLivePlayback.current || expectedGeneration !== dropGeneration.current) return;
        if (queuedRecoveryDelay.current !== null) {
            const queuedDelay = queuedRecoveryDelay.current;
            queuedRecoveryDelay.current = null;
            scheduleAutomaticRecovery(queuedDelay, lastPlaybackAction.current);
            return;
        }
        if (played) {
            setTransportPaused(false);
            reportPresence('listening');
            updateLiveState('playing');
            return;
        }
        scheduleAutomaticRecovery(STALL_RECOVERY_DELAY_MS, 'play-failed');
    }, [armLiveFadeIn, attemptLivePlayback, cancelRecovery, pauseDropIns, reportPresence, scheduleAutomaticRecovery, updateLiveState]);

    function playBeaconOnly() {
        lastPlaybackAction.current = 'listen-beacon';
        dropGeneration.current += 1;
        if (!livePreparedRef.current) return;
        startReactiveAnalysis('beacon');
        setHasStarted(true);
        setTransportStopped(false);
        setTransportPaused(false);
        void playLive(liveState === 'error' || liveState === 'displaced', dropGeneration.current);
    }

    async function toggleTransportPause() {
        if (transportStopped) return;

        const language = activeDrop.current;
        // Pause belongs only to private, seekable introductions. The Beacon
        // is a live-edge stream: listeners either hear it now or stop it.
        if (!language) return;
        if (transportPaused) {
            const intro = dropAudio[language].current;
            if (!intro) return;
            try {
                startReactiveAnalysis(`intro-${language}`);
                await intro.play();
                setTransportPaused(false);
                reportPresence('listening');
            } catch {
                // Keep the paused state visible when the browser rejects resume.
            }
            return;
        }

        cancelDropFade();
        const intro = dropAudio[language].current;
        intro?.pause();
        analysisProvider.current?.pauseAnalysis();
        storeProgress(language);
        setTransportPaused(true);
        reportPresence('idle');
    }

    function stopTransport() {
        lastPlaybackAction.current = 'stop';
        playbackLifecycleGeneration.current += 1;
        backgroundSuspension.current = null;
        playbackWatchdog.current.reset();
        dropGeneration.current += 1;
        setTransportStopped(true);
        setTransportPaused(false);
        wantsLivePlayback.current = false;
        reportPresence('idle');
        analysisProvider.current?.pauseAnalysis();
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
        if (kind !== 'error') {
            // `stalled` and `suspend` are advisory and can be emitted while a
            // healthy forward buffer still exists. A single event must not
            // flash “Reconnecting” or rebuild HLS. The media-clock watchdog is
            // the authority after a sustained 15-second non-progress interval.
            nativeSuspendObserved.current = true;
            return;
        }
        reportPresence('idle');
        deferLiveFade();
        scheduleAutomaticRecovery(0, 'native-error');
    }, [deferLiveFade, reportPresence, scheduleAutomaticRecovery]);

    function handleNativePlaying() {
        if (!wantsLivePlayback.current) return;
        lastPlaybackAction.current = 'media-playing';
        playbackWatchdog.current.reset();
        nativeSuspendObserved.current = false;
        cancelRecovery(true);
        const introduction = activeDrop.current
            ? dropAudio[activeDrop.current].current
            : null;
        // The live element remains muted and playing behind an introduction
        // so Safari can hand off without another gesture. A paused intro is
        // therefore idle even if that hidden element emits `playing`.
        if (!introduction || !introduction.paused) reportPresence('listening');
        updateLiveState('playing');
        if (pendingLiveFade.current) beginLiveFade();
    }

    useEffect(() => {
        const probe = document.createElement('audio');
        probe.volume = 0.37;
        setVolumeSupported(Math.abs(probe.volume - 0.37) < 0.01);
    }, []);

    function changeVolume(next: number) {
        volumeRef.current = next;
        // Keep slider movement off React's render path. Updating the media
        // elements directly avoids decorative UI work competing with audio.
        for (const audio of [liveAudio.current, dropAudio.es.current, dropAudio.en.current]) {
            if (audio && (audio !== liveAudio.current || liveFadeFrame.current === null)) {
                audio.volume = next;
            }
        }
    }

    useEffect(() => {
        const suspendForBackground = () => {
            if (document.visibilityState === 'visible' || backgroundSuspension.current) return;
            const introduction = activeDrop.current;
            if (!wantsLivePlayback.current && !introduction) return;

            playbackLifecycleGeneration.current += 1;
            const rebuildHls = hls.current !== null;
            backgroundSuspension.current = {
                source: introduction ?? 'beacon',
                rebuildHls,
            };
            lastPlaybackAction.current = 'background-suspend';
            playbackWatchdog.current.reset();
            cancelRecovery(true);
            wantsLivePlayback.current = false;
            reportPresence('idle');
            analysisProvider.current?.pauseAnalysis();

            const live = liveAudio.current;
            live?.pause();
            if (introduction) {
                dropAudio[introduction].current?.pause();
                cancelLiveFade();
                pendingLiveFade.current = false;
                liveSuppressedForDrop.current = true;
                if (live) {
                    live.muted = true;
                    if (volumeSupported) live.volume = 0;
                }
            } else {
                deferLiveFade();
            }
            if (rebuildHls) stopHls();
            updateLiveState('paused');
        };

        const resumeAfterBackground = async () => {
            if (document.visibilityState !== 'visible') return;
            const suspension = backgroundSuspension.current;
            if (!suspension) {
                if (!wantsLivePlayback.current) revalidateIdlePreparedSource();
                return;
            }
            backgroundSuspension.current = null;
            playbackLifecycleGeneration.current += 1;
            const lifecycleGeneration = playbackLifecycleGeneration.current;
            lastPlaybackAction.current = 'foreground-resume';
            wantsLivePlayback.current = true;
            cancelRecovery(true);
            updateLiveState('loading');

            const introduction = suspension.source === 'beacon'
                ? null
                : dropAudio[suspension.source].current;
            const introResume = introduction
                ? introduction.play().then(() => true).catch(() => false)
                : Promise.resolve(true);
            const liveResume = attemptLivePlayback(
                suspension.rebuildHls,
                true,
                lifecycleGeneration,
            );
            const [introPlayed, livePlayed] = await Promise.all([introResume, liveResume]);
            if (
                lifecycleGeneration !== playbackLifecycleGeneration.current
                || document.visibilityState !== 'visible'
            ) return;

            if (livePlayed && introPlayed) {
                nativeSuspendObserved.current = false;
                playbackWatchdog.current.reset();
                setTransportPaused(false);
                reportPresence('listening');
                updateLiveState('playing');
                if (!introduction) beginLiveFade();
                else startReactiveAnalysis(`intro-${suspension.source}`);
                return;
            }

            if (introduction && !introPlayed) {
                setTransportPaused(true);
                reportPresence('idle');
                updateLiveState('paused');
                return;
            }
            scheduleAutomaticRecovery(STALL_RECOVERY_DELAY_MS, 'foreground-resume-failed');
        };

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') void resumeAfterBackground();
            else suspendForBackground();
        };
        const recoverVisibleTransport = () => {
            if (document.visibilityState !== 'visible') return;
            if (backgroundSuspension.current) {
                void resumeAfterBackground();
                return;
            }
            if (!wantsLivePlayback.current) {
                revalidateIdlePreparedSource();
                return;
            }
            const leaseNearExpiry = manifestExpiresAt.current <= Date.now() + 30_000;
            const suspendedWithoutFutureData = nativeSuspendObserved.current
                && Boolean(liveAudio.current)
                && (liveAudio.current?.readyState ?? 0) < 3;
            const activeHlsNetworkRecovery = hls.current !== null
                && lastHlsSignal.current.fatal === true
                && lastHlsSignal.current.type === 'networkError';
            if (activeHlsNetworkRecovery) {
                // Refreshing the existing grant extends the exact same origin
                // token. Restart hls.js in place so an online event never
                // discards a still-playable forward buffer.
                void probeExistingLease().then((probe) => {
                    if (probe.kind === 'active') {
                        manifestExpiresAt.current = Date.parse(probe.grant.stream.expiresAt);
                        const currentAudio = liveAudio.current;
                        const bufferExhausted = currentAudio !== null
                            && listenerBufferedAheadSeconds(currentAudio)
                                <= LISTENER_BUFFER_EXHAUSTED_EPSILON_SECONDS;
                        if (bufferExhausted) {
                            cancelHlsRefill(false);
                            cancelRecovery(false);
                            scheduleAutomaticRecovery(0, 'online-buffer-exhausted');
                        } else if (hls.current) {
                            const activeInstance = hls.current;
                            cancelHlsRefill(false);
                            scheduleHlsRefill(activeInstance, 0);
                        }
                        return;
                    }
                    if (
                        liveAudio.current
                        && listenerBufferedAheadSeconds(liveAudio.current)
                            <= LISTENER_BUFFER_EXHAUSTED_EPSILON_SECONDS
                    ) {
                        cancelRecovery(false);
                        scheduleAutomaticRecovery(0, 'online-buffer-exhausted');
                    }
                });
                return;
            }
            if (
                liveStateRef.current === 'recovering'
                || (!hls.current && leaseNearExpiry)
                || suspendedWithoutFutureData
            ) {
                cancelRecovery(false);
                scheduleAutomaticRecovery(0, 'foreground-health-check');
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('online', recoverVisibleTransport);
        window.addEventListener('pageshow', recoverVisibleTransport);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('online', recoverVisibleTransport);
            window.removeEventListener('pageshow', recoverVisibleTransport);
        };
    }, [
        attemptLivePlayback,
        beginLiveFade,
        cancelLiveFade,
        cancelHlsRefill,
        cancelRecovery,
        deferLiveFade,
        dropAudio,
        reportPresence,
        probeExistingLease,
        revalidateIdlePreparedSource,
        scheduleHlsRefill,
        scheduleAutomaticRecovery,
        startReactiveAnalysis,
        stopHls,
        updateLiveState,
        volumeSupported,
    ]);

    useEffect(() => {
        if (!reactiveVisualizationEnabled) return;
        const resumeAnalysisAfterForeground = () => {
            const provider = analysisProvider.current;
            if (document.visibilityState !== 'visible' || !provider || !wantsLivePlayback.current) return;
            if (provider.getStatus().phase !== 'suspended') return;
            void provider.start().then((result) => {
                if (!result.ok) onReactiveVisualizationFailure();
            }).catch(() => onReactiveVisualizationFailure());
        };
        document.addEventListener('visibilitychange', resumeAnalysisAfterForeground);
        window.addEventListener('pageshow', resumeAnalysisAfterForeground);
        return () => {
            document.removeEventListener('visibilitychange', resumeAnalysisAfterForeground);
            window.removeEventListener('pageshow', resumeAnalysisAfterForeground);
        };
    }, [onReactiveVisualizationFailure, reactiveVisualizationEnabled]);

    useEffect(() => {
        const interval = window.setInterval(async () => {
            // The native element is prepared before the first gesture for iOS,
            // so its lease must also remain current while playback is idle.
            if (!leaseId.current) return;
            const probe = await probeExistingLease();
            if (
                probe.kind === 'displaced'
                || probe.kind === 'denied'
                || probe.kind === 'refresh-required'
            ) {
                wantsLivePlayback.current = false;
                reportPresence('idle');
                cancelRecovery(true);
                liveAudio.current?.pause();
                stopHls();
                clearLeaseCursor();
                livePreparedRef.current = false;
                setLivePrepared(false);
                setDevicePreparedByGesture(false);
                setPrepareFailure(probe.kind === 'displaced' ? 'capacity' : 'unavailable');
                updateLiveState(probe.kind === 'displaced' ? 'displaced' : 'error');
                return;
            }
            if (probe.kind === 'reacquire') {
                clearLeaseCursor();
                livePreparedRef.current = false;
                setLivePrepared(false);
                setDevicePreparedByGesture(false);
                if (wantsLivePlayback.current) scheduleAutomaticRecovery(0, 'lease-expired');
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
    }, [cancelRecovery, clearLeaseCursor, prepareLiveSource, probeExistingLease, reportPresence, scheduleAutomaticRecovery, stopHls, updateLiveState]);

    useEffect(() => () => {
        playbackLifecycleGeneration.current += 1;
        backgroundSuspension.current = null;
        wantsLivePlayback.current = false;
        reportPresence('idle');
        cancelRecovery(true);
        cancelLiveFade();
        cancelDropFade();
        pendingLiveFade.current = false;
        activeDrop.current = null;
        liveAudio.current?.pause();
        stopHls();
    }, [cancelDropFade, cancelLiveFade, cancelRecovery, reportPresence, stopHls]);

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
        lastPlaybackAction.current = `listen-intro-${language}`;
        const selected = dropAudio[language].current;
        if (!selected || !dropIns[language]) return;
        startReactiveAnalysis(`intro-${language}`);
        // The intro already contains the Beacon, so the shared stream must stay
        // inaudible underneath it. Starting both prepared elements inside this
        // gesture preserves iOS authorization for the later automatic handoff.
        // Pausing the live element here would make Safari require another tap.
        cancelLiveFade();
        pendingLiveFade.current = false;
        if (liveAudio.current) {
            liveAudio.current.muted = true;
            liveSuppressedForDrop.current = true;
            if (volumeSupported) liveAudio.current.volume = 0;
        }
        const other: DropLanguage = language === 'es' ? 'en' : 'es';
        dropAudio[other].current?.pause();
        cancelDropFade();
        if (selected.error) selected.load();
        selected.currentTime = 0;
        selected.volume = volumeRef.current;
        const generation = dropGeneration.current + 1;
        dropGeneration.current = generation;
        activeDrop.current = language;
        const isCurrent = () => dropGeneration.current === generation && activeDrop.current === language;
        try {
            let liveStarted: Promise<void> | null = null;
            if (!wantsLivePlayback.current && livePreparedRef.current && liveAudio.current) {
                wantsLivePlayback.current = true;
                hlsReservoir.current?.enable();
                cancelRecovery(true);
                updateLiveState('loading');
                seekNativeAudioToLiveEdge(liveAudio.current);
                // Keep the exact prepared lease and manifest. Once media starts,
                // the sequenced LISTENING heartbeat promotes this lease without
                // replacing the source or leaving the Safari user gesture.
                liveStarted = liveAudio.current.play();
            }
            const introStarted = selected.play();
            if (!wantsLivePlayback.current) {
                wantsLivePlayback.current = true;
                hlsReservoir.current?.enable();
                cancelRecovery(true);
                updateLiveState('loading');
                void attemptLivePlayback().then((played) => {
                    if (!wantsLivePlayback.current) return;
                    if (played) updateLiveState('playing');
                    else scheduleAutomaticRecovery(STALL_RECOVERY_DELAY_MS, 'intro-live-start-failed');
                });
            }
            await introStarted;
            if (!isCurrent()) return;
            if (liveStarted) {
                void liveStarted.then(() => updateLiveState('playing')).catch(() => {
                    scheduleAutomaticRecovery(STALL_RECOVERY_DELAY_MS, 'intro-native-live-start-failed');
                });
            }
            setHasStarted(true);
            setTransportStopped(false);
            setTransportPaused(false);
            setPlayingDrop(language);
            reportPresence('listening');
        } catch {
            if (!isCurrent()) return;
            activeDrop.current = null;
            setTransportStopped(true);
            setPlayingDrop(null);
            wantsLivePlayback.current = false;
            liveAudio.current?.pause();
            if (liveAudio.current) {
                liveAudio.current.muted = false;
                liveAudio.current.volume = volumeRef.current;
            }
            liveSuppressedForDrop.current = false;
            reportPresence('idle');
            setPrepareFailure('unavailable');
            updateLiveState('idle');
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
        lastPlaybackAction.current = 'intro-handoff';
        startReactiveAnalysis('beacon');
        if (liveAudio.current && !liveAudio.current.paused) {
            cancelRecovery(true);
            setTransportPaused(false);
            updateLiveState('playing');
            pendingLiveFade.current = true;
            beginLiveFade();
            return;
        }
        void playLive(false, dropGeneration.current);
    }

    const selectedProgress = dropProgress[selectedDrop];
    const selectedDropAvailable = Boolean(dropIns[selectedDrop]);
    const transportBusy = liveState === 'loading' || liveState === 'recovering' || livePreparing;
    const phase = deriveListenerPresentationPhase({
        liveState,
        livePreparing,
        playingDrop,
        transportPaused,
        transportStopped,
        hasStarted,
    });
    const phaseLabel = phase === 'preparing' ? copy.loading
        : phase === 'reconnecting' ? copy.reconnecting
            : phase === 'unavailable' ? copy.unavailable
                : phase === 'displaced' ? copy.displaced
                    : null;
    const transportActive = !transportStopped;
    const introProgressVisible = selectedDropAvailable
        && (playingDrop === selectedDrop || (transportPaused && activeDrop.current === selectedDrop));
    const availableDropCount = Number(Boolean(dropIns.es)) + Number(Boolean(dropIns.en));

    useEffect(() => {
        // The page language is also the natural introduction preference. Do
        // not replace an introduction that is already playing; apply the new
        // preference as soon as the transport returns to rest.
        if (transportActive) return;
        setSelectedDrop(preferredDropLanguage(locale, dropIns.es, dropIns.en));
    }, [dropIns.en, dropIns.es, locale, transportActive]);

    function selectPlaybackMode(mode: PlaybackMode) {
        if (transportActive || transportBusy) return;
        setPlaybackMode(mode);
        try {
            window.localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, mode);
        } catch {
            // The preference is intentionally local and non-essential.
        }
    }

    function startSelectedMode() {
        if (!livePreparedRef.current) return;
        if (playbackMode === 'intro') {
            void playWithIntro(selectedDrop);
            return;
        }
        playBeaconOnly();
    }

    function skipToBeacon() {
        lastPlaybackAction.current = 'skip-to-beacon';
        dropGeneration.current += 1;
        setTransportPaused(false);
        startReactiveAnalysis('beacon');
        void playLive(false, dropGeneration.current);
    }

    return (
        <div className="listener-experience" data-phase={phase}>
            {reactiveVisualizationEnabled && reactiveRendererAvailable && (
                <div className="listener-reactive-field" data-testid="listener-reactive-field">
                    <ReactiveCampfireCanvas
                        subscribeFrames={subscribeReactiveFrames}
                        mode={transportActive && !transportPaused ? 'active' : 'stopped'}
                        settings={reactiveSettings}
                        onRendererError={() => {
                            const provider = analysisProvider.current;
                            provider?.pauseAnalysis();
                            setReactiveRendererAvailable(false);
                            // Rendering is disposable. Remote analysis never
                            // owns or reroutes the audible media element.
                            if (!provider) onReactiveVisualizationFailure();
                        }}
                    />
                </div>
            )}
            <audio
                ref={liveAudio}
                preload="auto"
                aria-label={copy.heading}
                onError={() => handleNativeInterruption('error')}
                onStalled={() => handleNativeInterruption('stalled')}
                onSuspend={() => handleNativeInterruption('suspend')}
                onPlaying={handleNativePlaying}
            />
            <section className="listener-stage">
                <h1 id="listener-heading" className="sr-only">{copy.heading}</h1>

                {phaseLabel && <p
                    role={phase === 'unavailable' || phase === 'displaced' ? 'alert' : 'status'}
                    className="listener-stage__status"
                >
                    <span className="listener-stage__status-dot" aria-hidden="true" />
                    {phaseLabel}
                </p>}

                <div className="listener-control-panel">
                    {reactiveFieldLabAvailable && reactiveFallbackNotice && (
                        <p role="status" className="listener-stage__hint">
                            {locale === 'es'
                                ? 'El campo reactivo no pudo iniciarse. El reproductor directo está listo.'
                                : 'The reactive field could not start. Direct playback is ready.'}
                        </p>
                    )}
                    {reactiveFieldLabAvailable && reactiveVisualizationAvailable && !transportActive && (
                        <label className="listener-reactive-option">
                            <input
                                type="checkbox"
                                checked={reactiveVisualizationEnabled}
                                disabled={transportBusy}
                                onChange={(event) => onReactiveVisualizationChange(event.target.checked)}
                            />
                            <span>{locale === 'es' ? 'Campo reactivo · experimental' : 'Reactive field · experimental'}</span>
                        </label>
                    )}

                    {reactiveFieldLabAvailable && reactiveVisualizationEnabled && !reactiveRendererAvailable && (
                        <p role="status" className="listener-stage__hint">
                            {locale === 'es'
                                ? 'La visualización se detuvo; el audio continúa sin ella.'
                                : 'The visualization stopped; audio continues without it.'}
                        </p>
                    )}

                    {availableDropCount > 0 && !transportActive && (
                        <label className="listener-intro-option">
                            <input
                                type="checkbox"
                                checked={playbackMode === 'intro'}
                                disabled={transportBusy || !selectedDropAvailable}
                                onChange={(event) => selectPlaybackMode(event.target.checked ? 'intro' : 'beacon')}
                            />
                            <span>{copy.playIntroFirst}</span>
                        </label>
                    )}

                    <div className="listener-details">
                        {availableDropCount > 1 && playbackMode === 'intro' && !transportActive && (
                            <label className="listener-details__selection">
                                <span>{copy.introSelection}</span>
                                <select
                                    value={selectedDrop}
                                    onChange={(event) => setSelectedDrop(event.target.value as DropLanguage)}
                                    aria-label={copy.introSelection}
                                >
                                    {dropIns.en && <option value="en">{copy.english}</option>}
                                    {dropIns.es && <option value="es">{copy.spanish}</option>}
                                </select>
                            </label>
                        )}

                        {volumeSupported && (
                            <label className="listener-details__control">
                                <span>{copy.master}</span>
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={volumeRef.current}
                                    onChange={(event) => changeVolume(Number(event.target.value))}
                                />
                            </label>
                        )}

                        {introProgressVisible && (
                            <div className="listener-details__seek">
                                <label>
                                    <span>{copy.seek}</span>
                                    <input
                                        type="range"
                                        aria-label={copy.seek}
                                        min={0}
                                        max={Math.max(selectedProgress.duration, 0)}
                                        step={0.1}
                                        value={Math.min(selectedProgress.current, selectedProgress.duration || 0)}
                                        onChange={(event) => seekDropIn(selectedDrop, Number(event.target.value))}
                                    />
                                    <span className="listener-details__time">
                                        <span>{formatTime(selectedProgress.current)}</span>
                                        <span>{formatTime(selectedProgress.duration)}</span>
                                    </span>
                                </label>
                                <button type="button" onClick={skipToBeacon}>{copy.skipToBeacon}</button>
                            </div>
                        )}
                    </div>

                    <div className={`listener-transport${transportActive ? ' listener-transport--active' : ''}${transportActive && playingDrop === null ? ' listener-transport--stop-only' : ''}`}>
                        {!transportActive && (
                            <button
                                type="button"
                                onClick={livePrepared ? startSelectedMode : () => void claimLiveSource()}
                                disabled={transportBusy || (livePrepared && playbackMode === 'intro' && !selectedDropAvailable)}
                                className="listener-transport__primary"
                            >
                                <span aria-hidden="true">▶</span>
                                {transportBusy ? copy.loading : livePrepared ? copy.listen : copy.prepareDevice}
                            </button>
                        )}
                        {playingDrop !== null && transportActive && (
                            <button
                                type="button"
                                onClick={() => void toggleTransportPause()}
                                disabled={transportBusy}
                                className="listener-transport__primary"
                            >
                                {transportPaused ? copy.resume : copy.pause}
                            </button>
                        )}
                        {transportActive && (
                            <button
                                type="button"
                                onClick={stopTransport}
                                className="listener-transport__secondary"
                            >
                                {copy.stop}
                            </button>
                        )}
                    </div>

                    {devicePreparedByGesture && liveState === 'idle' && (
                        <p role="status" className="listener-stage__hint">
                            {copy.deviceReady}
                        </p>
                    )}
                    {!livePreparing && !livePrepared && liveState !== 'error' && (
                        <p role="status" className="listener-stage__hint">
                            {prepareFailure === 'capacity' ? copy.deviceLimitClaim : copy.prepareHelp}
                        </p>
                    )}
                </div>
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

                {reactiveFieldLabAvailable && (
                    <ReactiveCampfireTuningPanel
                        enabled={reactiveVisualizationAvailable && reactiveVisualizationEnabled}
                        settings={reactiveSettings}
                        analysisControlsLocked
                        analysisSource="server"
                        onChange={(next) => onReactiveSettingsChange({
                            ...next,
                            fftSize: reactiveSettings.fftSize,
                            baselineDurationSeconds: reactiveSettings.baselineDurationSeconds,
                        })}
                    />
                )}

            </section>
        </div>
    );
}

export default function ListenerPlayer({
    dropIns,
    reactiveVisualizationAvailable = false,
    reactiveVisualizationInitiallyEnabled = false,
    reactiveFieldLabAvailable = false,
}: ListenerPlayerProps) {
    const [reactiveVisualizationEnabled, setReactiveVisualizationEnabled] = useState(
        reactiveVisualizationAvailable && reactiveVisualizationInitiallyEnabled,
    );
    const [reactiveFallbackNotice, setReactiveFallbackNotice] = useState(false);
    const [reactiveSettings, setReactiveSettings] = useState<ReactiveCampfireSettings>({
        ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
    });
    const runtimeVisualizationAvailable = useSyncExternalStore(
        subscribeRuntimeVisualizationCapability,
        () => (
            reactiveVisualizationAvailable
            && supportsReactiveListenerVisualization(navigator)
        ),
        () => false,
    );
    return (
        <ListenerPlayerController
            dropIns={dropIns}
            reactiveVisualizationAvailable={runtimeVisualizationAvailable}
            reactiveFieldLabAvailable={reactiveFieldLabAvailable}
            reactiveVisualizationEnabled={reactiveVisualizationEnabled}
            reactiveSettings={reactiveSettings}
            reactiveFallbackNotice={reactiveFallbackNotice}
            onReactiveSettingsChange={setReactiveSettings}
            onReactiveVisualizationChange={(enabled) => {
                setReactiveFallbackNotice(false);
                setReactiveVisualizationEnabled(enabled);
            }}
            onReactiveVisualizationFailure={() => {
                setReactiveFallbackNotice(true);
                setReactiveVisualizationEnabled(false);
            }}
        />
    );
}
