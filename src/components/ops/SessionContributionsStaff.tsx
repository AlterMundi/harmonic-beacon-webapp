'use client';

import type { Messages } from '@/lib/i18n';

import {
    useContributionsFeed,
    type StaffContribution,
} from '../session/useContributionsFeed';

/**
 * CHAT-01 UI (#141): the staff reading of the questions-and-emotions feed,
 * mounted as a drawer of the ConductorCockpit. Compact console list — real
 * author, body, timestamp, and the "anonymous to the audience" badge —
 * optimized for reading and capture. No moderation controls yet (#134).
 */

function formatTime(iso: string, locale: string): string {
    const date = new Date(iso);
    return date.toLocaleTimeString(locale === 'en' ? 'en-US' : 'es-CR', {
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function SessionContributionsStaff({
    sessionId,
    copy,
    active,
    locale,
}: {
    sessionId: string;
    copy: Messages['ops']['contributionsPanel'];
    active: boolean;
    locale: 'es' | 'en';
}) {
    const feed = useContributionsFeed<StaffContribution>({
        sessionId,
        audience: 'staff',
        active,
    });

    return (
        <div className="space-y-3" data-testid="staff-contributions">
            {feed.status === 'loading' && (
                <p className="py-6 text-center text-xs text-[var(--text-muted)]">{copy.loading}</p>
            )}
            {feed.status === 'error' && (
                <div className="py-6 text-center" role="alert">
                    <p className="text-xs text-[var(--danger)]">{copy.error}</p>
                    <button
                        type="button"
                        onClick={feed.reload}
                        className="mt-2 text-xs text-[var(--gold)] underline"
                    >
                        {copy.retry}
                    </button>
                </div>
            )}
            {feed.status === 'ended' && (
                <p className="py-6 text-center text-xs text-[var(--danger)]" role="alert">{copy.error}</p>
            )}
            {(feed.status === 'ready' || feed.status === 'draining') && (
                <>
                    {feed.status === 'draining' && (
                        <p className="py-1 text-center text-xs text-[var(--text-muted)]" role="status">{copy.loading}</p>
                    )}
                    {feed.items.length === 0 && feed.status === 'ready' && (
                        <p className="py-6 text-center text-xs text-[var(--text-muted)]">{copy.empty}</p>
                    )}
                    <ol className="divide-y divide-[var(--border-subtle)]">
                        {feed.items.map((item) => (
                            <li key={item.id} className="py-2" data-state={item.state}>
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <strong className="break-words text-xs text-[var(--cream)]">
                                        {item.authorDisplayName}
                                    </strong>
                                    <time
                                        dateTime={item.createdAt}
                                        className="font-mono text-xs text-[var(--text-muted)]"
                                    >
                                        {formatTime(item.createdAt, locale)}
                                    </time>
                                    {item.audienceAnonymous && (
                                        <span className="rounded-full border border-[var(--gold)]/40 px-2 py-0.5 text-xs uppercase tracking-[0.06em] text-[var(--gold)]">
                                            {copy.anonymousBadge}
                                        </span>
                                    )}
                                    {item.state !== 'VISIBLE' && (
                                        <span className="rounded-full border border-[var(--danger)]/40 px-2 py-0.5 text-xs uppercase tracking-[0.06em] text-[var(--danger)]">
                                            {item.state}
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[var(--paper)] [overflow-wrap:anywhere]">
                                    {item.body}
                                </p>
                            </li>
                        ))}
                    </ol>
                </>
            )}
        </div>
    );
}
