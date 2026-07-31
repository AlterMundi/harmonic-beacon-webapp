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

import type { HealthLevel, OperatorHealthReport, SubsystemCheck } from '@/lib/ops-health';
import ThumbnailTapestry from '@/components/session/ThumbnailTapestry';

const POLL_INTERVAL_MS = 10_000;

const CHECK_LABELS: Array<{ key: keyof OperatorHealthReport['checks']; label: string }> = [
    { key: 'postgres', label: 'PostgreSQL' },
    { key: 'livekit', label: 'LiveKit API' },
    { key: 'stageRoom', label: 'Stage room' },
    { key: 'publisherGrants', label: 'Publisher grants' },
    { key: 'bedPublisher', label: 'Bed publisher (playlist bot)' },
    { key: 'tapestry', label: 'Tapestry (cuttable)' },
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

const LEVEL_HEADLINES: Record<HealthLevel, string> = {
    green: 'GREEN — all subsystems nominal',
    yellow: 'YELLOW — degraded, cuttable subsystem failing',
    red: 'RED — launch-blocking subsystem failing',
};

function CheckRow({ label, check }: { label: string; check: SubsystemCheck }) {
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
                        {check.status}
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

export default function OpsHealthClient({ role, sessionId }: { role: string; sessionId?: string }) {
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
                throw new Error(`Endpoint answered HTTP ${response.status}`);
            }
            const body = (await response.json()) as OperatorHealthReport;
            if (mounted.current) {
                setReport(body);
                setEndpointError(null);
            }
        } catch (error) {
            if (mounted.current) {
                setEndpointError(
                    error instanceof Error ? error.message : 'Health endpoint unreachable',
                );
            }
        } finally {
            if (mounted.current) {
                setLoading(false);
            }
        }
    }, [sessionId]);

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
                    ? `RED — health endpoint unreachable: ${endpointError}`
                    : report
                      ? LEVEL_HEADLINES[report.status]
                      : loading
                        ? 'Checking subsystems…'
                        : 'YELLOW — no report yet'}
            </div>

            {report?.session ? (
                <p className="text-sm text-[var(--text-secondary)]">
                    Watching session <span className="font-medium text-[var(--cream)]">{report.session.title}</span>{' '}
                    ({report.session.status}) — signed in as {role}.
                </p>
            ) : (
                <p className="text-sm text-[var(--text-secondary)]">
                    No live or scheduled session is being watched — signed in as {role}.
                </p>
            )}

            {report ? (
                <ul className="space-y-2">
                    {CHECK_LABELS.map(({ key, label }) => (
                        <CheckRow key={key} label={label} check={report.checks[key]} />
                    ))}
                </ul>
            ) : null}

            {report?.session ? <ThumbnailTapestry sessionId={report.session.id} staffOnly /> : null}

            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>
                    {report
                        ? `Last checked ${new Date(report.checkedAt).toLocaleTimeString()} — refreshes every ${POLL_INTERVAL_MS / 1000}s`
                        : 'Waiting for the first report…'}
                </span>
                <button
                    type="button"
                    onClick={() => void refresh()}
                    className="rounded border border-[var(--border-subtle)] px-3 py-1 text-xs hover:bg-white/5"
                >
                    Refresh now
                </button>
            </div>
        </section>
    );
}
