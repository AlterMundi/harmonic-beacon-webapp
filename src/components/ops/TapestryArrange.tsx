'use client';

/**
 * Tapestry arrangement panel for the ops session console (issue #53).
 *
 * Staff see the active tiles in display order and reorder them with the
 * arrow buttons; saving persists the arrangement via the ops API, and the
 * composite reflects it immediately. The list refreshes on an interval but
 * never clobbers an unsaved local arrangement — new arrivals are appended.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const REFRESH_INTERVAL_MS = 5_000;

type Props = { sessionId: string };

export default function TapestryArrange({ sessionId }: Props) {
    const [order, setOrder] = useState<string[]>([]);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [refreshTick, setRefreshTick] = useState(0);
    const dirtyRef = useRef(false);
    dirtyRef.current = dirty;

    const refresh = useCallback(async () => {
        try {
            const response = await fetch(`/api/ops/sessions/${sessionId}/tapestry`, { cache: 'no-store' });
            if (!response.ok) {
                return;
            }
            const data = await response.json() as { participants?: string[] };
            const active = Array.isArray(data.participants) ? data.participants : [];
            setOrder((current) => {
                if (!dirtyRef.current) {
                    return active;
                }
                // Merge: keep the local arrangement, drop departed, append new.
                const kept = current.filter((id) => active.includes(id));
                const arrivals = active.filter((id) => !kept.includes(id));
                return [...kept, ...arrivals];
            });
            setRefreshTick((tick) => tick + 1);
        } catch {
            // The panel is advisory; the next tick retries.
        }
    }, [sessionId]);

    useEffect(() => {
        void refresh();
        const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [refresh]);

    const move = (index: number, delta: number) => {
        setOrder((current) => {
            const target = index + delta;
            if (target < 0 || target >= current.length) {
                return current;
            }
            const next = [...current];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
        setDirty(true);
        setMessage(null);
    };

    const save = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const response = await fetch(`/api/ops/sessions/${sessionId}/tapestry`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ order }),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            setDirty(false);
            setMessage('Arrangement saved');
        } catch {
            setMessage('Could not save the arrangement — try again');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="mt-8 rounded-lg border border-[var(--border-subtle)] p-4" aria-live="polite">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Tapestry arrangement
                </h2>
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={!dirty || saving}
                    className="min-h-11 rounded border border-[var(--gold)] px-3 py-2 text-xs text-[var(--gold)] disabled:opacity-40"
                >
                    {saving ? 'Saving…' : dirty ? 'Save arrangement' : 'Saved'}
                </button>
            </div>
            {order.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                    No attendee snapshots yet — tiles appear here as cameras join.
                </p>
            ) : (
                <ol className="flex flex-wrap gap-3">
                    {order.map((pid, index) => (
                        <li key={pid} className="flex flex-col items-center gap-1">
                            {/* refreshTick busts the cache so tiles track live frames */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={`/api/ops/sessions/${sessionId}/tapestry/tiles/${encodeURIComponent(pid)}?t=${refreshTick}`}
                                alt={`Tapestry tile ${index + 1}`}
                                width={72}
                                height={72}
                                className="rounded border border-[var(--border-subtle)]"
                            />
                            <div className="flex gap-1">
                                <button
                                    type="button"
                                    aria-label={`Move tile ${index + 1} left`}
                                    onClick={() => move(index, -1)}
                                    disabled={index === 0}
                                    className="min-h-11 min-w-11 rounded border border-[var(--border-subtle)] px-2 text-xs disabled:opacity-30"
                                >
                                    ◀
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Move tile ${index + 1} right`}
                                    onClick={() => move(index, 1)}
                                    disabled={index === order.length - 1}
                                    className="min-h-11 min-w-11 rounded border border-[var(--border-subtle)] px-2 text-xs disabled:opacity-30"
                                >
                                    ▶
                                </button>
                            </div>
                        </li>
                    ))}
                </ol>
            )}
            {message ? <p className="mt-2 text-xs text-[var(--text-muted)]">{message}</p> : null}
        </section>
    );
}
