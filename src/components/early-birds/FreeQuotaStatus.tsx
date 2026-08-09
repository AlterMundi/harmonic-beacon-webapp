'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdCopy } from '@/lib/early-birds/copy';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

import {
    formatQuotaDuration,
    isNewerQuotaSnapshot,
    listenerQuotaSnapshot,
    quotaSnapshotFromAccessState,
    type SerializedEarlyBirdQuotaSnapshot,
} from './free-quota';

type Props = {
    snapshot?: SerializedEarlyBirdQuotaSnapshot | null;
    serverNow: string;
    compact?: boolean;
    unlimited?: 'membership' | 'free-for-all' | null;
};

function monotonicNow() {
    return typeof performance !== 'undefined' ? performance.now() : 0;
}

function serverElapsed(receivedAt: number, now: number) {
    // Date.now is used only as an elapsed-time clock after a server snapshot;
    // browser wall time never authorizes or chooses a quota boundary.
    return Math.max(0, now - receivedAt);
}

export default function FreeQuotaStatus({ snapshot, serverNow, compact = false, unlimited = null }: Props) {
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const router = useRouter();
    const initial = useMemo(() => listenerQuotaSnapshot(snapshot, serverNow), [snapshot, serverNow]);
    const [state, setState] = useState(initial);
    const [receivedAt, setReceivedAt] = useState(monotonicNow);
    const [tickNow, setTickNow] = useState(monotonicNow);
    const stateRef = useRef(state);
    stateRef.current = state;

    useEffect(() => {
        if (initial && (!stateRef.current || isNewerQuotaSnapshot(initial, stateRef.current))) {
            setState(initial);
            setReceivedAt(monotonicNow());
        }
    }, [initial]);

    useEffect(() => {
        if (!state?.activelyConsuming || unlimited) return;
        const interval = window.setInterval(() => setTickNow(monotonicNow()), 1_000);
        return () => window.clearInterval(interval);
    }, [state?.activelyConsuming, unlimited]);

    useEffect(() => {
        let cancelled = false;
        let inFlight = false;
        let retryTimer: number | null = null;

        const revalidate = async () => {
            if (cancelled || inFlight) return;
            inFlight = true;
            try {
                const response = await fetch(LISTENER_NAMESPACE.canonical.api.accessState, {
                    cache: 'no-store',
                    headers: { Accept: 'application/json' },
                });
                if (!response.ok) return;
                const payload = await response.json();
                if (cancelled) return;
                const next = quotaSnapshotFromAccessState(payload);
                const previous = stateRef.current;
                if (next && (!previous || isNewerQuotaSnapshot(next, previous))) {
                    setState(next);
                    setReceivedAt(monotonicNow());
                    // Only route-changing quota transitions refresh the server
                    // tree. Available→listening is a presentation update and
                    // must never remount the player mid-listen.
                    if (next.status === 'exhausted' || previous?.status === 'exhausted') router.refresh();
                }
                const nextKind = payload?.access?.kind;
                if (nextKind && nextKind !== 'free-quota' && nextKind !== 'membership') router.refresh();
                if (next?.status === 'exhausted') router.refresh();
            } catch {
                // A failed client revalidation never invents entitlement. Media
                // authorization continues to fail closed at the server.
            } finally {
                inFlight = false;
            }
        };

        const onResume = () => {
            if (document.visibilityState !== 'hidden') void revalidate();
        };
        const onPlaybackPresence = () => void revalidate();
        const interval = state?.activelyConsuming && !unlimited
            ? window.setInterval(() => void revalidate(), 30_000)
            : null;
        const boundaryAt = state?.exhaustsAt ?? state?.nextCycleAt;
        const boundaryAtMs = boundaryAt ? Date.parse(boundaryAt) : Number.NaN;
        const serverNowAt = state ? Date.parse(state.serverNow) : Number.NaN;
        if (Number.isFinite(boundaryAtMs) && Number.isFinite(serverNowAt)) {
            retryTimer = window.setTimeout(
                () => void revalidate(),
                Math.max(0, boundaryAtMs - serverNowAt - serverElapsed(receivedAt, monotonicNow()) + 750),
            );
        }
        window.addEventListener('pageshow', onResume);
        window.addEventListener('listener:playback-presence', onPlaybackPresence);
        document.addEventListener('visibilitychange', onResume);
        return () => {
            cancelled = true;
            if (interval !== null) window.clearInterval(interval);
            if (retryTimer !== null) window.clearTimeout(retryTimer);
            window.removeEventListener('pageshow', onResume);
            window.removeEventListener('listener:playback-presence', onPlaybackPresence);
            document.removeEventListener('visibilitychange', onResume);
        };
    }, [receivedAt, router, state, unlimited]);

    const elapsed = state?.activelyConsuming && !unlimited ? serverElapsed(receivedAt, tickNow) : 0;
    const remaining = Math.max(0, (state?.remainingMs ?? 0) - elapsed);
    const renewalAt = state?.nextCycleAt ?? state?.cycleEndsAt;
    const untilRenewal = state && renewalAt
        ? Math.max(0, Date.parse(renewalAt) - Date.parse(state.serverNow) - serverElapsed(receivedAt, tickNow))
        : null;

    let title = copy.freeQuotaTitle;
    let detail = copy.freeQuotaNotStarted;
    if (unlimited === 'membership') {
        title = copy.freeQuotaFounder;
        detail = copy.freeQuotaUnlimited;
    } else if (unlimited === 'free-for-all') {
        title = copy.freeQuotaFreeForAll;
        detail = copy.freeQuotaUnlimited;
    } else if (!state) {
        return null;
    } else if (state.status === 'exhausted') {
        title = copy.freeQuotaExhausted;
        detail = copy.freeQuotaRenews;
    } else if (state.status === 'available' || state.status === 'listening') {
        title = copy.freeQuotaRemaining.replace('{time}', formatQuotaDuration(remaining, locale));
        detail = state.status === 'listening' ? copy.freeQuotaListening : copy.freeQuotaAvailable;
    }

    const rootClass = compact ? 'listener-quota listener-quota--compact' : 'listener-quota';
    return (
        <section className={rootClass} data-quota-status={unlimited ? 'unlimited' : state!.status}>
            <strong>{title}</strong>
            {!compact && <p>{detail}</p>}
            {!unlimited && (state?.bonusAllowanceMs ?? 0) > 0 && (
                <small>{copy.freeQuotaExtra.replace('{time}', formatQuotaDuration(state?.bonusAllowanceMs ?? 0, locale))}</small>
            )}
            {!unlimited && untilRenewal !== null && (
                <small>{copy.freeQuotaResetsIn.replace('{time}', formatQuotaDuration(untilRenewal, locale))}</small>
            )}
        </section>
    );
}
