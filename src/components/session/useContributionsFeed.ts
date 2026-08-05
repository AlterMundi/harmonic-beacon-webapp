'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * CHAT-01 UI (#141): the client adapter for the session contributions
 * contract (docs/architecture/SESSION_CONTRIBUTIONS.md). One hook per
 * session and audience; it owns the page envelope cursors, the incremental
 * poll and the response ordering guarantees. It never builds URLs with
 * author, participant or ticket identifiers — the server resolves identity
 * from the hb_session cookie.
 */

export type ContributionVisibility = 'NAMED' | 'ANONYMOUS';

export type PublicContribution = {
    id: string;
    body: string;
    displayName: string | null;
    visibility: ContributionVisibility;
    createdAt: string;
};

export type StaffContribution = {
    id: string;
    body: string;
    authorDisplayName: string;
    participantIdentity: string;
    visibility: ContributionVisibility;
    audienceAnonymous: boolean;
    state: 'VISIBLE' | 'HIDDEN' | 'WITHDRAWN';
    createdAt: string;
};

type ContributionPage<T> = {
    contributions: T[];
    hasMore: boolean;
    nextPageCursor: string | null;
    resumeCursor: string | null;
};

export type FeedStatus = 'loading' | 'draining' | 'ready' | 'ended' | 'error';

export type SubmitResult =
    | { kind: 'created'; contribution: PublicContribution }
    | { kind: 'replay'; contribution: PublicContribution }
    | { kind: 'rate_limited'; retryAfterSeconds: number }
    | { kind: 'conflict' }
    | { kind: 'not_joined' }
    | { kind: 'ended' }
    | { kind: 'error' };

const PAGE_LIMIT = 50;
const MAX_DRAIN_PAGES = 10;
export const CONTRIBUTIONS_POLL_MS = 5000;

async function readErrorCode(response: Response): Promise<string | null> {
    try {
        const payload = (await response.clone().json()) as { code?: unknown };
        return typeof payload.code === 'string' ? payload.code : null;
    } catch {
        return null;
    }
}

export function useContributionsFeed<T extends PublicContribution | StaffContribution>({
    sessionId,
    audience,
    active = true,
}: {
    sessionId: string;
    audience: 'public' | 'staff';
    /** False while the surrounding panel/drawer is collapsed: pauses polling. */
    active?: boolean;
}) {
    const [items, setItems] = useState<T[]>([]);
    const [status, setStatus] = useState<FeedStatus>('loading');
    const [pollFailed, setPollFailed] = useState(false);
    const cursorRef = useRef<string | null>(null);
    const generationRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const pollInFlightRef = useRef(false);
    const [reloadKey, setReloadKey] = useState(0);
    const reload = useCallback(() => setReloadKey((value) => value + 1), []);

    const endpoint = audience === 'staff'
        ? `/api/ops/sessions/${sessionId}/contributions`
        : `/api/scheduled-sessions/${sessionId}/contributions`;

    const fetchPage = useCallback(async (
        cursor: string | null,
        signal: AbortSignal,
    ): Promise<{ page?: ContributionPage<T>; ended?: boolean; failed?: boolean }> => {
        const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
        if (cursor) params.set('cursor', cursor);
        let response: Response;
        try {
            response = await fetch(`${endpoint}?${params.toString()}`, {
                signal,
                headers: { Accept: 'application/json' },
            });
        } catch {
            return { failed: true };
        }
        if (response.status === 403 || response.status === 401 || response.status === 404) {
            return { ended: true };
        }
        if (!response.ok) return { failed: true };
        const payload = (await response.json()) as ContributionPage<T>;
        // A malformed page (proxy mangling, stale cache, mismatched deploy)
        // is a recoverable feed error, never a render-time crash.
        if (!payload || !Array.isArray(payload.contributions)) return { failed: true };
        return { page: payload };
    }, [endpoint]);

    // Initial load: drain the backlog with nextPageCursor, then keep
    // resumeCursor as the polling cursor. A fresh generation aborts every
    // in-flight request from the previous session.
    useEffect(() => {
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        cursorRef.current = null;
        pollInFlightRef.current = false;
        setItems([]);
        setPollFailed(false);
        setStatus('loading');

        const seen = new Set<string>();
        const merge = (rows: T[]) => {
            setItems((previous) => {
                const next = [...previous];
                for (const row of rows) {
                    if (!seen.has(row.id)) {
                        seen.add(row.id);
                        next.push(row);
                    }
                }
                return next;
            });
        };

        void (async () => {
            let cursor: string | null = null;
            for (let page = 0; page < MAX_DRAIN_PAGES; page += 1) {
                const result = await fetchPage(cursor, controller.signal);
                if (generationRef.current !== generation) return;
                if (result.ended) { setStatus('ended'); return; }
                if (result.failed || !result.page) { setStatus('error'); return; }
                merge(result.page.contributions);
                if (!result.page.hasMore) {
                    cursorRef.current = result.page.resumeCursor;
                    setStatus('ready');
                    return;
                }
                cursor = result.page.nextPageCursor;
                setStatus('draining');
            }
            // Defensive cap: keep polling from the last known cursor rather
            // than looping forever on an unbounded backlog.
            cursorRef.current = cursor;
            setStatus('ready');
        })();

        return () => controller.abort();
    }, [fetchPage, reloadKey, sessionId]);

    // Incremental polling with the tail cursor. Empty pages (both cursors
    // null) leave our cursor untouched — it stays valid.
    useEffect(() => {
        if (status !== 'ready' || !active) return;
        const generation = generationRef.current;
        const poll = async () => {
            if (document.visibilityState !== 'visible') return;
            if (pollInFlightRef.current) return;
            pollInFlightRef.current = true;
            try {
                const controller = new AbortController();
                abortRef.current = controller;
                const result = await fetchPage(cursorRef.current, controller.signal);
                if (generationRef.current !== generation) return;
                if (result.ended) { setStatus('ended'); return; }
                if (result.failed || !result.page) { setPollFailed(true); return; }
                setPollFailed(false);
                if (result.page.contributions.length > 0) {
                    setItems((previous) => {
                        const known = new Set(previous.map((row) => row.id));
                        const fresh = result.page!.contributions.filter((row) => !known.has(row.id));
                        return fresh.length > 0 ? [...previous, ...fresh] : previous;
                    });
                    cursorRef.current = result.page.resumeCursor ?? cursorRef.current;
                }
            } finally {
                pollInFlightRef.current = false;
            }
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') void poll();
        };
        const timer = setInterval(() => void poll(), CONTRIBUTIONS_POLL_MS);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [active, fetchPage, status]);

    const submit = useCallback(async ({
        body,
        visibility,
        idempotencyKey,
    }: {
        body: string;
        visibility: ContributionVisibility;
        idempotencyKey: string;
    }): Promise<SubmitResult> => {
        let response: Response;
        try {
            response = await fetch(`/api/scheduled-sessions/${sessionId}/contributions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ body, visibility, idempotencyKey }),
            });
        } catch {
            return { kind: 'error' };
        }
        if (response.status === 201 || response.status === 200) {
            const contribution = (await response.json()) as PublicContribution;
            setItems((previous) => previous.some((row) => row.id === contribution.id)
                ? previous
                : [...previous, contribution as unknown as T]);
            return { kind: response.status === 201 ? 'created' : 'replay', contribution };
        }
        if (response.status === 429) {
            let retryAfterSeconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
            try {
                const payload = (await response.json()) as { retryAfterSeconds?: unknown };
                if (typeof payload.retryAfterSeconds === 'number') {
                    retryAfterSeconds = payload.retryAfterSeconds;
                }
            } catch { /* header-only fallback */ }
            return { kind: 'rate_limited', retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 60 };
        }
        const code = await readErrorCode(response);
        if (response.status === 409 && code === 'idempotency_key_conflict') return { kind: 'conflict' };
        if (response.status === 409 && code === 'participant_not_joined') return { kind: 'not_joined' };
        if (response.status === 403) {
            setStatus('ended');
            return { kind: 'ended' };
        }
        return { kind: 'error' };
    }, [sessionId]);

    return { items, status, pollFailed, submit, reload };
}
