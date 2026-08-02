'use client';

/**
 * Live board for `/ops/health`.
 *
 * Polls `/api/ops/health` every ten seconds. Each server-side probe is bounded
 * at three seconds, so a subsystem that dies shows up here non-green within
 * roughly one poll interval — comfortably inside the 30-second detection
 * budget the runbook assumes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StaffRole } from '@prisma/client';

import { messages, type Messages, type UiLocale } from '@/lib/i18n';
import type { HealthLevel, OperatorHealthReport, SubsystemCheck } from '@/lib/ops-health';
import ThumbnailTapestry from '@/components/session/ThumbnailTapestry';

const POLL_INTERVAL_MS = 10_000;

const CHECK_KEYS: Array<keyof OperatorHealthReport['checks']> = [
    'postgres',
    'livekit',
    'stageRoom',
    'publisherGrants',
    'bedPublisher',
    'tapestry',
];

const LEVEL_STYLES: Record<HealthLevel, { banner: string; dot: string; text: string }> = {
    green: {
        banner: 'border-[var(--lime)]/40 bg-[var(--lime)]/10 text-[var(--lime)]',
        dot: 'bg-[var(--lime)]',
        text: 'text-[var(--lime)]',
    },
    yellow: {
        banner: 'border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]',
        dot: 'bg-[var(--warning)]',
        text: 'text-[var(--warning)]',
    },
    red: {
        banner: 'border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]',
        dot: 'bg-[var(--danger)]',
        text: 'text-[var(--danger)]',
    },
};

function fill(template: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
    );
}

function CheckRow({
    label,
    check,
    copy,
}: {
    label: string;
    check: SubsystemCheck;
    copy: Messages['ops']['healthPanel'];
}) {
    const styles = LEVEL_STYLES[check.status];
    return (
        <li className="flex items-start gap-3 rounded border border-[var(--border-subtle)] px-4 py-3">
            <span
                aria-hidden
                className={`mt-1.5 inline-block h-3 w-3 shrink-0 rounded-full ${styles.dot}`}
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-[var(--cream)]">{label}</span>
                    <span className={`text-xs font-semibold uppercase ${styles.text}`}>
                        {copy.levels[check.status]}
                    </span>
                </div>
                <p className="text-sm text-[var(--text-secondary)]">{check.detail}</p>
                {check.error ? (
                    <p className="mt-1 break-words font-mono text-xs text-[var(--text-muted)]">
                        {check.error}
                    </p>
                ) : null}
            </div>
            <span className="shrink-0 font-mono text-xs text-[var(--text-muted)]">
                {check.latencyMs} ms
            </span>
        </li>
    );
}

export default function OpsHealthClient({
    role,
    sessionId,
    locale,
    copy,
    staffRoles,
    onLevelChange,
}: {
    role: StaffRole;
    sessionId?: string;
    locale: UiLocale;
    copy: Messages['ops']['healthPanel'];
    staffRoles: Messages['staffRoles'];
    onLevelChange?: (level: HealthLevel) => void;
}) {
    const [report, setReport] = useState<OperatorHealthReport | null>(null);
    const [endpointError, setEndpointError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const mounted = useRef(true);

    const refresh = useCallback(async () => {
        try {
            const endpoint = sessionId
                ? `/api/ops/health?sessionId=${encodeURIComponent(sessionId)}`
                : '/api/ops/health';
            const response = await fetch(endpoint, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(fill(copy.endpointHttp, { status: response.status }));
            }
            const body = (await response.json()) as OperatorHealthReport;
            if (mounted.current) {
                setReport(body);
                setEndpointError(null);
                onLevelChange?.(body.status);
            }
        } catch (error) {
            if (mounted.current) {
                setEndpointError(
                    error instanceof Error ? error.message : copy.endpointUnavailable,
                );
                onLevelChange?.('red');
            }
        } finally {
            if (mounted.current) {
                setLoading(false);
            }
        }
    }, [sessionId, onLevelChange, copy.endpointHttp, copy.endpointUnavailable]);

    useEffect(() => {
        mounted.current = true;
        void refresh();
        const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
        return () => {
            mounted.current = false;
            clearInterval(timer);
        };
    }, [refresh]);

    const effectiveLevel: HealthLevel = endpointError ? 'red' : (report?.status ?? 'yellow');
    const styles = LEVEL_STYLES[effectiveLevel];

    return (
        <section className="space-y-4" aria-live="polite">
            <div className={`rounded-lg border px-4 py-3 font-semibold ${styles.banner}`}>
                {endpointError
                    ? fill(copy.endpointAlarm, { error: endpointError })
                    : report
                      ? copy.headlines[report.status]
                      : loading
                        ? copy.checking
                        : copy.noReport}
            </div>

            {report?.session ? (
                <p className="text-sm text-[var(--text-secondary)]">
                    {copy.watchingSession} <span className="font-medium text-[var(--cream)]">{report.session.title}</span>{' '}
                    ({copy.sessionStatuses[report.session.status]}) — {copy.signedInAs} {staffRoles[role]}.
                </p>
            ) : (
                <p className="text-sm text-[var(--text-secondary)]">
                    {copy.noSession} — {copy.signedInAs} {staffRoles[role]}.
                </p>
            )}

            {report ? (
                <ul className="space-y-2">
                    {CHECK_KEYS.map((key) => (
                        <CheckRow key={key} label={copy.checks[key]} check={report.checks[key]} copy={copy} />
                    ))}
                </ul>
            ) : null}

            {report?.session ? (
                <ThumbnailTapestry
                    sessionId={report.session.id}
                    staffOnly
                    labels={messages[locale].tapestry}
                />
            ) : null}

            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>
                    {report
                        ? `${copy.lastChecked} ${new Date(report.checkedAt).toLocaleTimeString(locale === 'es' ? 'es-AR' : 'en-GB')} — ${fill(copy.refreshesEvery, { seconds: POLL_INTERVAL_MS / 1000 })}`
                        : copy.waitingFirstReport}
                </span>
                <button
                    type="button"
                    onClick={() => void refresh()}
                    className="min-h-11 rounded border border-[var(--border-subtle)] px-3 py-2 text-xs hover:bg-white/5"
                >
                    {copy.refreshNow}
                </button>
            </div>
        </section>
    );
}
