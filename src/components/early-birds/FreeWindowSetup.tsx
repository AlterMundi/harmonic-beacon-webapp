'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useLocale } from '@/context/LocaleContext';
import type { SerializedEarlyBirdFreeWindowState } from '@/lib/early-birds/free-window';
import { earlyBirdCopy } from '@/lib/early-birds/copy';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

function currentLocalTime(): string {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function localStartMinute(value: string): number | null {
    const match = value.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
}

export default function FreeWindowSetup({ state }: { state: SerializedEarlyBirdFreeWindowState }) {
    const router = useRouter();
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const [timeZone, setTimeZone] = useState<string | null>(null);
    const [time, setTime] = useState(currentLocalTime);
    const [choosing, setChoosing] = useState(false);
    const [busy, setBusy] = useState<'now' | 'custom' | null>(null);
    const [error, setError] = useState(false);
    const selectionRequestId = useRef<string | null>(null);

    useEffect(() => {
        setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    }, []);

    const formatInstant = (value: string | null) => {
        if (!value || !state.timeZone) return null;
        return new Intl.DateTimeFormat(locale === 'es' ? 'es-AR' : 'en', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: state.timeZone,
        }).format(new Date(value));
    };

    const formatLocalStart = (minute: number | null) => {
        if (minute === null) return null;
        const instant = new Date(Date.UTC(2026, 0, 1, Math.floor(minute / 60), minute % 60));
        return new Intl.DateTimeFormat(locale === 'es' ? 'es' : 'en', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'UTC',
        }).format(instant);
    };

    async function select(mode: 'now' | 'custom') {
        if (!timeZone || busy !== null) return;
        const minute = localStartMinute(time);
        if (mode === 'custom' && minute === null) return;
        selectionRequestId.current ??= crypto.randomUUID();
        setBusy(mode);
        setError(false);
        try {
            const response = await fetch(LISTENER_NAMESPACE.canonical.api.freeWindow, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode,
                    timeZone,
                    localStartMinute: mode === 'custom' ? minute : undefined,
                    selectionRequestId: selectionRequestId.current,
                }),
            });
            if (response.ok) {
                selectionRequestId.current = null;
                setBusy(null);
                setChoosing(false);
                router.refresh();
                return;
            }
        } catch {}
        setBusy(null);
        setError(true);
    }

    const nextWindow = formatInstant(state.nextStart);
    const changeAllowed = formatInstant(state.changeAllowedAt);
    const savedStart = formatLocalStart(state.localStartMinute);
    const mayChoose = !state.configured || state.canChange;

    return (
        <div className="listener-free-window" aria-busy={busy !== null}>
            <h3>{copy.freeTitle}</h3>
            <p>{copy.freeDescription}</p>

            {state.configured && savedStart && state.timeZone && (
                <p className="listener-free-window__fact">
                    <span>{copy.savedFreeTime}</span>
                    <strong>{savedStart} · {state.timeZone}</strong>
                </p>
            )}
            {state.configured && nextWindow && (
                <p className="listener-free-window__fact">
                    <span>{copy.nextFreeWindow}</span>
                    <strong>{nextWindow}</strong>
                </p>
            )}
            {state.configured && !state.canChange && changeAllowed && (
                <p className="listener-free-window__fact">
                    <span>{copy.freeScheduleLocked}</span>
                    <strong>{changeAllowed}</strong>
                </p>
            )}

            {mayChoose && !choosing && (
                <div className="listener-free-window__actions">
                    <button
                        type="button"
                        className="listener-button listener-button--primary w-full"
                        disabled={!timeZone || busy !== null}
                        onClick={() => select('now')}
                    >
                        {busy === 'now' ? copy.startingFreeTime : copy.listenFreeNow}
                    </button>
                    <button
                        type="button"
                        className="listener-button listener-button--secondary w-full"
                        disabled={!timeZone || busy !== null}
                        onClick={() => setChoosing(true)}
                    >
                        {copy.chooseFreeTime}
                    </button>
                </div>
            )}

            {mayChoose && choosing && (
                <div className="listener-free-window__chooser">
                    <label>
                        <span>{copy.freeStartTime}</span>
                        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
                    </label>
                    <p><span>{copy.freeTimeZone}</span> · {timeZone}</p>
                    <button
                        type="button"
                        className="listener-button listener-button--primary w-full"
                        disabled={!timeZone || busy !== null || localStartMinute(time) === null}
                        onClick={() => select('custom')}
                    >
                        {busy === 'custom' ? copy.savingFreeTime : copy.saveFreeTime}
                    </button>
                    <button
                        type="button"
                        className="listener-button listener-button--secondary w-full"
                        disabled={busy !== null}
                        onClick={() => setChoosing(false)}
                    >
                        {copy.cancelFreeTime}
                    </button>
                </div>
            )}

            {error && <p role="alert" className="listener-alert listener-alert--error">{copy.freeScheduleError}</p>}
        </div>
    );
}
