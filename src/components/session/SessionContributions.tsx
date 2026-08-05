'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';

import {
    useContributionsFeed,
    type ContributionVisibility,
    type PublicContribution,
} from './useContributionsFeed';

/**
 * CHAT-01 UI (#141): the attendee questions-and-emotions panel. Desktop:
 * collapsible side panel; mobile: collapsible section below the scene — the
 * parent layout decides placement, this component never overlays the stage,
 * the tapestry or the audio controls. Two explicit actions per message
 * (Compartir → NAMED, Compartir anónimo → ANONYMOUS); no remembered or
 * preselected visibility.
 */

const MAX_BODY_CODE_POINTS = 1000;
const DRAFT_STORAGE_PREFIX = 'hb-contrib-draft:';

type ComposerError = 'send' | 'retry' | null;

function codePoints(text: string): number {
    return [...text].length;
}

function readDraft(sessionId: string): { body: string; key: string } | null {
    try {
        const raw = window.sessionStorage.getItem(`${DRAFT_STORAGE_PREFIX}${sessionId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { body?: unknown; key?: unknown };
        return typeof parsed.body === 'string' && typeof parsed.key === 'string'
            ? { body: parsed.body, key: parsed.key }
            : null;
    } catch {
        return null;
    }
}

export default function SessionContributions({ sessionId }: { sessionId: string }) {
    const { copy } = useLocale();
    const t = copy.contributions;
    const [expanded, setExpanded] = useState(true);
    const feed = useContributionsFeed<PublicContribution>({
        sessionId,
        audience: 'public',
        active: expanded,
    });

    // ---- composer state ----
    // Draft (and its idempotency key) restore lazily from this session's
    // storage slot; the parent mounts us with key={sessionId}, so a session
    // change is a full remount and no state can cross sessions.
    const [draft] = useState<{ body: string; key: string } | null>(() => (
        typeof window === 'undefined' ? null : readDraft(sessionId)
    ));
    const [body, setBody] = useState(draft?.body ?? '');
    const [key, setKey] = useState<string | null>(draft?.key ?? null);
    const [sending, setSending] = useState<ContributionVisibility | null>(null);
    const [error, setError] = useState<ComposerError>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [rateLimitLeft, setRateLimitLeft] = useState(0);
    const [online, setOnline] = useState(() => (
        typeof window === 'undefined' ? true : window.navigator.onLine
    ));
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    // ---- feed scroll state ----
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const atBottomRef = useRef(true);
    const [newBelow, setNewBelow] = useState(false);

    // Persist the draft so refresh/reconnect resends with the same key.
    useEffect(() => {
        try {
            if (body.length > 0 && key) {
                window.sessionStorage.setItem(
                    `${DRAFT_STORAGE_PREFIX}${sessionId}`,
                    JSON.stringify({ body, key }),
                );
            } else if (body.length === 0) {
                window.sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${sessionId}`);
            }
        } catch { /* storage may be unavailable */ }
    }, [body, key, sessionId]);

    useEffect(() => {
        const goOffline = () => setOnline(false);
        const goOnline = () => setOnline(true);
        window.addEventListener('offline', goOffline);
        window.addEventListener('online', goOnline);
        return () => {
            window.removeEventListener('offline', goOffline);
            window.removeEventListener('online', goOnline);
        };
    }, []);

    // Rate-limit countdown: never retry before the server-granted window.
    useEffect(() => {
        if (rateLimitLeft <= 0) return;
        const timer = setInterval(() => {
            setRateLimitLeft((left) => (left > 1 ? left - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }, [rateLimitLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

    const scrollToBottom = useCallback(() => {
        const node = scrollRef.current;
        if (node) node.scrollTop = node.scrollHeight;
        atBottomRef.current = true;
        setNewBelow(false);
    }, []);

    // Follow the tail only when the reader is already at the bottom.
    const itemCount = feed.items.length;
    useEffect(() => {
        if (itemCount === 0) return;
        if (atBottomRef.current) {
            const node = scrollRef.current;
            if (node) node.scrollTop = node.scrollHeight;
            return;
        }
        const frame = window.requestAnimationFrame(() => setNewBelow(true));
        return () => window.cancelAnimationFrame(frame);
    }, [itemCount]);

    const onFeedScroll = useCallback(() => {
        const node = scrollRef.current;
        if (!node) return;
        const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
        atBottomRef.current = atBottom;
        if (atBottom) setNewBelow(false);
    }, []);

    const onChangeBody = useCallback((value: string) => {
        const points = [...value];
        const next = points.length > MAX_BODY_CODE_POINTS
            ? points.slice(0, MAX_BODY_CODE_POINTS).join('')
            : value;
        setBody(next);
        setError(null);
        setKey((current) => current ?? window.crypto.randomUUID());
    }, []);

    const submit = useCallback(async (visibility: ContributionVisibility) => {
        const trimmed = body.trim();
        if (!trimmed || sending || rateLimitLeft > 0) return;
        const submitKey = key ?? window.crypto.randomUUID();
        setKey(submitKey);
        setSending(visibility);
        setError(null);
        setNotice(null);
        const result = await feed.submit({ body: trimmed, visibility, idempotencyKey: submitKey });
        setSending(null);
        switch (result.kind) {
            case 'created':
                setBody('');
                setKey(null);
                try { window.sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${sessionId}`); } catch { /* noop */ }
                setNotice(t.published);
                atBottomRef.current = true;
                scrollToBottom();
                textareaRef.current?.focus();
                break;
            case 'replay':
                // Canonical success: the message already exists; resolve
                // silently like a plain success.
                setBody('');
                setKey(null);
                try { window.sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${sessionId}`); } catch { /* noop */ }
                atBottomRef.current = true;
                scrollToBottom();
                textareaRef.current?.focus();
                break;
            case 'rate_limited':
                setRateLimitLeft(Math.max(1, result.retryAfterSeconds));
                break;
            case 'conflict':
                // Same key, different payload: rotate and offer an explicit resend.
                setKey(window.crypto.randomUUID());
                setError('retry');
                break;
            default:
                setError('send');
                break;
        }
    }, [body, feed, key, rateLimitLeft, scrollToBottom, sending, sessionId, t.published]);

    const disabled = sending !== null || rateLimitLeft > 0 || !online || body.trim().length === 0;
    const remaining = MAX_BODY_CODE_POINTS - codePoints(body);
    const statusMessage = !online
        ? t.offline
        : rateLimitLeft > 0
          ? t.rateLimited.replace('{seconds}', String(rateLimitLeft))
          : sending !== null
            ? t.sending
            : error !== null
              ? t.error
              : feed.pollFailed
                ? t.reconnecting
                : notice;

    const headingId = `contributions-heading-${sessionId}`;
    const noteId = `contributions-anonymity-${sessionId}`;

    return (
        <section
            aria-labelledby={headingId}
            className="w-full border-t border-[var(--border-subtle)] bg-[var(--night)]/60 lg:flex lg:h-full lg:w-96 lg:shrink-0 lg:flex-col lg:border-l lg:border-t-0"
            data-testid="session-contributions"
        >
            <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`contributions-body-${sessionId}`}
                onClick={() => setExpanded((value) => !value)}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
                <h2 id={headingId} className="text-xs font-mono uppercase tracking-[0.12em] text-[var(--gold)]">
                    {t.heading}
                </h2>
                <span aria-hidden="true" className="text-[var(--text-secondary)]">{expanded ? '−' : '+'}</span>
                <span className="sr-only">{expanded ? t.collapse : t.expand}</span>
            </button>

            <div
                id={`contributions-body-${sessionId}`}
                hidden={!expanded}
                className="flex min-h-0 flex-col gap-3 px-4 pb-4 lg:flex-1"
            >
                {feed.status === 'loading' && (
                    <p className="py-6 text-center text-xs text-[var(--text-muted)]">{t.loading}</p>
                )}
                {feed.status === 'draining' && (
                    <p className="py-2 text-center text-xs text-[var(--text-muted)]" role="status">{t.loadingEarlier}</p>
                )}
                {feed.status === 'error' && (
                    <p className="py-6 text-center text-xs text-[var(--danger)]" role="alert">{t.error}</p>
                )}
                {feed.status === 'ended' && (
                    <p className="py-4 text-center text-xs leading-5 text-[var(--text-muted)]">{t.sessionEnded}</p>
                )}

                {(feed.status === 'ready' || feed.status === 'draining' || feed.status === 'ended') && (
                    <div className="relative min-h-0 lg:flex-1">
                        <div
                            ref={scrollRef}
                            onScroll={onFeedScroll}
                            aria-label={t.heading}
                            aria-live={feed.status === 'ready' ? 'polite' : 'off'}
                            aria-relevant="additions"
                            className="max-h-72 space-y-3 overflow-y-auto pr-1 lg:max-h-none lg:h-full motion-reduce:scroll-auto"
                            data-testid="contributions-feed"
                        >
                            {feed.items.length === 0 && feed.status !== 'draining' && (
                                <p className="py-6 text-center text-xs leading-5 text-[var(--text-muted)]">{t.empty}</p>
                            )}
                            {feed.items.map((item) => (
                                <article key={item.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-alt)]/60 px-3 py-2">
                                    <p className="text-xs font-mono uppercase tracking-[0.08em] text-[var(--gold)]">
                                        {item.visibility === 'ANONYMOUS' ? t.anonymousAuthor : item.displayName}
                                    </p>
                                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--paper)] [overflow-wrap:anywhere]">
                                        {item.body}
                                    </p>
                                </article>
                            ))}
                        </div>
                        {newBelow && (
                            <button
                                type="button"
                                onClick={scrollToBottom}
                                className="absolute inset-x-6 bottom-2 rounded-full border border-[var(--gold)]/40 bg-[var(--night)] px-3 py-1.5 text-xs text-[var(--gold)] shadow-lg"
                            >
                                {t.newMessages}
                            </button>
                        )}
                    </div>
                )}

                {feed.status !== 'ended' && (
                    <form
                        onSubmit={(event) => event.preventDefault()}
                        className="mt-auto space-y-2"
                    >
                        <label htmlFor={`contributions-text-${sessionId}`} className="block text-sm leading-5 text-[var(--cream)]">
                            {t.prompt}
                        </label>
                        <textarea
                            id={`contributions-text-${sessionId}`}
                            ref={textareaRef}
                            value={body}
                            onChange={(event) => onChangeBody(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    void submit('NAMED');
                                }
                            }}
                            placeholder={t.placeholder}
                            rows={3}
                            aria-describedby={noteId}
                            className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-alt)] px-3 py-2 text-sm leading-6 text-[var(--paper)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
                        />
                        <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
                            <span>{t.keyboardHint}</span>
                            {remaining <= 200 && (
                                <span className={remaining === 0 ? 'text-[var(--warning)]' : ''} aria-live="polite">
                                    {remaining === 0 ? t.charLimit : remaining}
                                </span>
                            )}
                        </div>
                        <p id={noteId} className="text-xs leading-4 text-[var(--text-muted)]">
                            {t.anonymityNote}
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => void submit('NAMED')}
                                className="event-button event-button--primary min-h-11 w-full disabled:opacity-50"
                            >
                                {sending === 'NAMED' ? t.sending : t.share}
                            </button>
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => void submit('ANONYMOUS')}
                                className="event-button event-button--secondary min-h-11 w-full disabled:opacity-50"
                            >
                                {sending === 'ANONYMOUS' ? t.sending : t.shareAnonymous}
                            </button>
                        </div>
                        {error === 'retry' && (
                            <button
                                type="button"
                                onClick={() => void submit('NAMED')}
                                className="text-xs text-[var(--gold)] underline"
                            >
                                {t.retry}
                            </button>
                        )}
                        {statusMessage ? (
                            <p aria-live="polite" role="status" className={`min-h-4 text-xs ${error ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'}`}>
                                {statusMessage}
                            </p>
                        ) : null}
                    </form>
                )}
            </div>
        </section>
    );
}
