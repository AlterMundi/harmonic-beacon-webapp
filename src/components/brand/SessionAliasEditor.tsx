'use client';

import { useEffect, useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';
import type { UiLocale } from '@/lib/i18n';

const copy: Record<UiLocale, {
    edit: string;
    loading: string;
    label: string;
    save: string;
    saving: string;
    cancel: string;
    invalid: string;
    failed: string;
    saved: string;
}> = {
    es: {
        edit: 'Editar nombre en la sala',
        loading: 'Cargando nombre…',
        label: 'Nombre en esta sala',
        save: 'Guardar',
        saving: 'Guardando…',
        cancel: 'Cancelar',
        invalid: 'Escribí un nombre de hasta 60 caracteres.',
        failed: 'No pudimos actualizar tu nombre. Intentá de nuevo.',
        saved: 'Nombre actualizado.',
    },
    en: {
        edit: 'Edit your name in this room',
        loading: 'Loading name…',
        label: 'Name in this room',
        save: 'Save',
        saving: 'Saving…',
        cancel: 'Cancel',
        invalid: 'Enter a name of up to 60 characters.',
        failed: 'We could not update your name. Please try again.',
        saved: 'Name updated.',
    },
};

type Phase = 'closed' | 'loading' | 'editing' | 'saving';

function attendeeEntry(
    body: unknown,
    sessionId: string,
): { displayName: string } | null {
    if (!body || typeof body !== 'object') return null;
    const value = body as {
        identity?: unknown;
        session?: unknown;
    };
    if (!value.identity || typeof value.identity !== 'object' ||
        !value.session || typeof value.session !== 'object') return null;
    const identity = value.identity as {
        kind?: unknown;
        displayName?: unknown;
        confirmed?: unknown;
    };
    const session = value.session as { id?: unknown };
    if (identity.kind !== 'attendee' || typeof identity.displayName !== 'string' ||
        typeof identity.confirmed !== 'boolean' || session.id !== sessionId ||
        !identity.displayName.trim() || identity.displayName.length > 60) return null;
    return { displayName: identity.displayName };
}

function confirmedAlias(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const value = body as { displayName?: unknown; confirmed?: unknown };
    if (typeof value.displayName !== 'string' || value.confirmed !== true ||
        !value.displayName.trim() || value.displayName.length > 60) return null;
    return value.displayName;
}

export default function SessionAliasEditor({ sessionId }: { sessionId: string }) {
    const { locale } = useLocale();
    const labels = copy[locale];
    const [phase, setPhase] = useState<Phase>('closed');
    const [displayName, setDisplayName] = useState('');
    const [initialDisplayName, setInitialDisplayName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const requestGeneration = useRef(0);
    const activeRequest = useRef<AbortController | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    function supersedeRequest() {
        requestGeneration.current += 1;
        activeRequest.current?.abort();
        activeRequest.current = null;
        return requestGeneration.current;
    }

    useEffect(() => {
        supersedeRequest();
        setPhase('closed');
        setDisplayName('');
        setInitialDisplayName('');
        setError(null);
        setSaved(false);
        return () => {
            requestGeneration.current += 1;
            activeRequest.current?.abort();
        };
    }, [sessionId]);

    async function beginEditing() {
        if (phase !== 'closed') return;
        const generation = supersedeRequest();
        const controller = new AbortController();
        activeRequest.current = controller;
        setPhase('loading');
        setError(null);
        setSaved(false);
        try {
            const response = await fetch(
                `/api/scheduled-sessions/${encodeURIComponent(sessionId)}/entry`,
                { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal },
            );
            const body: unknown = await response.json().catch(() => null);
            if (requestGeneration.current !== generation) return;
            const entry = response.ok ? attendeeEntry(body, sessionId) : null;
            if (!entry) {
                setPhase('closed');
                setError(labels.failed);
                return;
            }
            setDisplayName(entry.displayName);
            setInitialDisplayName(entry.displayName);
            setPhase('editing');
            queueMicrotask(() => inputRef.current?.focus());
        } catch (failure) {
            if (requestGeneration.current !== generation ||
                (failure instanceof DOMException && failure.name === 'AbortError')) return;
            setPhase('closed');
            setError(labels.failed);
        } finally {
            if (requestGeneration.current === generation) activeRequest.current = null;
        }
    }

    function cancel() {
        if (phase === 'saving') return;
        supersedeRequest();
        setPhase('closed');
        setDisplayName('');
        setInitialDisplayName('');
        setError(null);
        setSaved(false);
    }

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (phase !== 'editing') return;
        const trimmed = displayName.trim();
        if (!trimmed || displayName.length > 60) {
            setError(labels.invalid);
            inputRef.current?.focus();
            return;
        }
        if (trimmed === initialDisplayName.trim()) return;

        const generation = supersedeRequest();
        const controller = new AbortController();
        activeRequest.current = controller;
        setPhase('saving');
        setError(null);
        setSaved(false);
        try {
            const response = await fetch(
                `/api/scheduled-sessions/${encodeURIComponent(sessionId)}/entry`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ displayName }),
                    signal: controller.signal,
                },
            );
            const body: unknown = await response.json().catch(() => null);
            if (requestGeneration.current !== generation) return;
            const confirmed = response.ok ? confirmedAlias(body) : null;
            if (!confirmed) {
                setPhase('editing');
                setError(response.status === 400 ? labels.invalid : labels.failed);
                return;
            }
            setDisplayName(confirmed);
            setInitialDisplayName(confirmed);
            setPhase('editing');
            setSaved(true);
        } catch (failure) {
            if (requestGeneration.current !== generation ||
                (failure instanceof DOMException && failure.name === 'AbortError')) return;
            setPhase('editing');
            setError(labels.failed);
        } finally {
            if (requestGeneration.current === generation) activeRequest.current = null;
        }
    }

    if (phase === 'closed') {
        return (
            <>
                <button
                    type="button"
                    role="menuitem"
                    onClick={(event) => {
                        event.stopPropagation();
                        void beginEditing();
                    }}
                >
                    {labels.edit}
                </button>
                {error ? <small role="alert">{error}</small> : null}
            </>
        );
    }

    if (phase === 'loading') {
        return <small role="status">{labels.loading}</small>;
    }

    const cannotSubmit = phase === 'saving' || !displayName.trim() ||
        displayName.length > 60 || displayName.trim() === initialDisplayName.trim();

    return (
        <form
            className="grid gap-2 border-y border-white/10 px-3 py-2"
            aria-label={labels.edit}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cancel();
                }
            }}
            onSubmit={(event) => void submit(event)}
            noValidate
        >
            <label className="text-xs text-[var(--text-secondary)]" htmlFor="hb-session-alias">
                {labels.label}
            </label>
            <input
                ref={inputRef}
                id="hb-session-alias"
                value={displayName}
                maxLength={60}
                autoComplete="off"
                disabled={phase === 'saving'}
                onChange={(event) => {
                    setDisplayName(event.target.value);
                    setError(null);
                    setSaved(false);
                }}
                className="min-h-10 rounded-md border border-white/20 bg-black/20 px-2 text-sm text-[var(--paper)] outline-none focus:border-[var(--gold)]"
            />
            <div className="grid grid-cols-2 gap-2">
                <button type="submit" disabled={cannotSubmit} aria-busy={phase === 'saving'}>
                    {phase === 'saving' ? labels.saving : labels.save}
                </button>
                <button type="button" disabled={phase === 'saving'} onClick={cancel}>
                    {labels.cancel}
                </button>
            </div>
            {error ? <small role="alert">{error}</small> : null}
            {saved ? <small role="status">{labels.saved}</small> : null}
        </form>
    );
}
