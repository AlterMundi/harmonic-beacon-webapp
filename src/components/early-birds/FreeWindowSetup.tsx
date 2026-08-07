'use client';

import { useEffect, useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';
import type { SerializedEarlyBirdFreeWindowState } from '@/lib/early-birds/free-window';
import { earlyBirdCopy } from '@/lib/early-birds/copy';

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
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const [timeZone, setTimeZone] = useState<string | null>(null);
    const [time, setTime] = useState(currentLocalTime);
    const [choosing, setChoosing] = useState(false);
    const [busy, setBusy] = useState(false);
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

    async function select(mode: 'now' | 'custom') {
        if (!timeZone || busy) return;
        const minute = localStartMinute(time);
        if (mode === 'custom' && minute === null) return;
        selectionRequestId.current ??= crypto.randomUUID();
        setBusy(true);
        setError(false);
        try {
            const response = await fetch('/api/early-birds/free-window', {
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
                window.location.reload();
                return;
            }
        } catch {}
        setBusy(false);
        setError(true);
    }

    const nextWindow = formatInstant(state.nextStart);
    const changeAllowed = formatInstant(state.changeAllowedAt);
    const mayChoose = !state.configured || state.canChange;

    return (
        <div className="listener-free-window">
            <h3>{copy.freeTitle}</h3>
            <p>{copy.freeDescription}</p>

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
                        className="event-button event-button--primary w-full"
                        disabled={!timeZone || busy}
                        onClick={() => select('now')}
                    >
                        {copy.listenFreeNow}
                    </button>
                    <button
                        type="button"
                        className="event-button event-button--secondary w-full"
                        disabled={!timeZone || busy}
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
                        className="event-button event-button--primary w-full"
                        disabled={!timeZone || busy || localStartMinute(time) === null}
                        onClick={() => select('custom')}
                    >
                        {copy.saveFreeTime}
                    </button>
                </div>
            )}

            {error && <p role="alert" className="event-alert event-alert--error">{copy.freeScheduleError}</p>}
        </div>
    );
}
