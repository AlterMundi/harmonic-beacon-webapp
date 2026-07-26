"use client";

import { useState, useEffect, useCallback } from "react";

interface ReportPerson {
    id: string;
    name: string | null;
    email: string | null;
}

interface AdminReport {
    id: string;
    targetType: string;
    targetId: string;
    reason: string;
    detail: string | null;
    status: string;
    resolution: string | null;
    acknowledgedAt: string | null;
    resolvedAt: string | null;
    createdAt: string;
    reporter: ReportPerson | null;
    handledBy: ReportPerson | null;
}

const filters = ["OPEN", "TRIAGED", "RESOLVED", "DISMISSED", "ALL"] as const;
type Filter = (typeof filters)[number];

const filterLabels: Record<Filter, string> = {
    OPEN: "Open",
    TRIAGED: "Triaged",
    RESOLVED: "Resolved",
    DISMISSED: "Dismissed",
    ALL: "All",
};

const reasonLabels: Record<string, string> = {
    SAFETY: "Safety",
    THERAPEUTIC_CLAIM: "Therapeutic claim",
    COPYRIGHT: "Copyright",
    SPAM: "Spam",
    OTHER: "Other",
};

/**
 * BUSINESS_RULES.md §10 names 24 hours for acknowledgement. Nothing enforces or
 * measures it, so the number is used here only to colour a row — never printed
 * as a promise.
 */
const ACKNOWLEDGEMENT_TARGET_MS = 24 * 60 * 60 * 1000;

/** Coarse enough to read at a glance, which is what a queue is scanned for. */
function formatElapsed(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "under a minute";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function personLabel(p: ReportPerson | null): string {
    if (!p) return "Deleted account";
    return p.name || p.email || "Anonymised account";
}

export default function AdminReportsPage() {
    const [activeFilter, setActiveFilter] = useState<Filter>("OPEN");
    const [reports, setReports] = useState<AdminReport[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
    const [resolutions, setResolutions] = useState<Record<string, string>>({});
    // Recomputed on every fetch so waiting times do not go stale while an admin
    // works the queue.
    const [now, setNow] = useState(() => Date.now());

    const fetchReports = useCallback(async () => {
        setLoading(true);
        try {
            const query = activeFilter === "ALL" ? "" : `?status=${activeFilter}`;
            const res = await fetch(`/api/admin/reports${query}`);
            if (res.ok) {
                const data = await res.json();
                setReports(data.reports || []);
                setCounts(data.counts || {});
            }
        } catch {
            // Silently fail
        } finally {
            setNow(Date.now());
            setLoading(false);
        }
    }, [activeFilter]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    const triage = async (id: string, status: string) => {
        setActionLoading(id);
        setActionError(null);
        try {
            const resolution = resolutions[id]?.trim();
            const res = await fetch(`/api/admin/reports/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status,
                    ...(resolution ? { resolution } : {}),
                }),
            });
            if (res.ok) {
                await fetchReports();
                setResolutions((prev) => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
            } else {
                const data = await res.json().catch(() => null);
                setActionError({ id, message: data?.error || "Triage failed" });
            }
        } catch {
            setActionError({ id, message: "Triage failed - could not reach the server" });
        } finally {
            setActionLoading(null);
        }
    };

    return (
        <main className="pb-8">
            {/* Status Filter */}
            <section className="px-4 py-4">
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {filters.map((f) => (
                        <button
                            key={f}
                            onClick={() => setActiveFilter(f)}
                            className={`px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${activeFilter === f
                                ? "bg-[var(--primary-600)] text-white"
                                : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                                }`}
                        >
                            {filterLabels[f]}
                            {f !== "ALL" && counts[f] ? (
                                <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
                            ) : null}
                        </button>
                    ))}
                </div>
            </section>

            {/* Report List */}
            <section className="px-4">
                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
                    </div>
                ) : reports.length === 0 ? (
                    <div className="glass-card p-6 text-center">
                        <p className="text-[var(--text-muted)]">
                            {activeFilter === "OPEN"
                                ? "No reports awaiting triage"
                                : `No ${filterLabels[activeFilter].toLowerCase()} reports`}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {reports.map((r, i) => {
                            const createdMs = new Date(r.createdAt).getTime();
                            const waitingMs = Math.max(0, now - createdMs);
                            const acknowledgedMs = r.acknowledgedAt
                                ? Math.max(0, new Date(r.acknowledgedAt).getTime() - createdMs)
                                : null;
                            const overdue = acknowledgedMs === null && waitingMs > ACKNOWLEDGEMENT_TARGET_MS;

                            return (
                                <div
                                    key={r.id}
                                    className="glass-card p-4 animate-fade-in"
                                    style={{ opacity: 0, animationDelay: `${i * 0.05}s` }}
                                >
                                    {/* Header: what and why */}
                                    <div className="flex items-start justify-between gap-3 mb-2">
                                        <div className="min-w-0">
                                            <h4 className="font-semibold">
                                                {reasonLabels[r.reason] || r.reason}
                                            </h4>
                                            <p className="text-xs text-[var(--text-muted)] mt-0.5 break-all">
                                                {r.targetType} &middot; {r.targetId}
                                            </p>
                                        </div>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary-700)]/30 text-[var(--primary-300)] flex-shrink-0">
                                            {r.status}
                                        </span>
                                    </div>

                                    {/* The two facts the queue exists to expose. */}
                                    <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
                                        <span
                                            className={`px-2 py-0.5 rounded-full ${overdue
                                                ? "bg-red-500/20 text-red-400"
                                                : "bg-white/5 text-[var(--text-muted)]"
                                                }`}
                                        >
                                            Waiting {formatElapsed(waitingMs)}
                                        </span>
                                        {acknowledgedMs === null ? (
                                            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                                                Not acknowledged
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                                                Acknowledged after {formatElapsed(acknowledgedMs)}
                                            </span>
                                        )}
                                    </div>

                                    <p className="text-xs text-[var(--text-muted)]">
                                        Filed {formatDate(r.createdAt)} by {personLabel(r.reporter)}
                                        {r.handledBy && <> &middot; handled by {personLabel(r.handledBy)}</>}
                                    </p>

                                    {r.detail && (
                                        <p className="text-sm text-[var(--text-secondary)] mt-2 whitespace-pre-wrap break-words">
                                            {r.detail}
                                        </p>
                                    )}

                                    {r.resolution && (
                                        <p className="text-xs text-[var(--text-secondary)] mt-2">
                                            Resolution: {r.resolution}
                                        </p>
                                    )}

                                    {actionError?.id === r.id && (
                                        <p role="alert" className="text-xs text-red-400 mt-2">
                                            {actionError.message}
                                        </p>
                                    )}

                                    {/* Actions — the four statuses PATCH accepts. */}
                                    <div className="pt-3 mt-3 border-t border-[var(--border-subtle)] space-y-2">
                                        <label htmlFor={`resolution-${r.id}`} className="sr-only">
                                            Resolution note for this report
                                        </label>
                                        <input
                                            id={`resolution-${r.id}`}
                                            type="text"
                                            value={resolutions[r.id] ?? ""}
                                            onChange={(e) =>
                                                setResolutions((prev) => ({ ...prev, [r.id]: e.target.value }))
                                            }
                                            placeholder="Resolution note (optional)"
                                            className="input-field text-xs py-2"
                                        />
                                        <div className="flex gap-2">
                                            {r.status === "OPEN" ? (
                                                <button
                                                    onClick={() => triage(r.id, "TRIAGED")}
                                                    disabled={actionLoading === r.id}
                                                    className="flex-1 py-2 rounded-lg bg-[var(--primary-600)]/30 text-[var(--primary-300)] text-sm font-medium hover:bg-[var(--primary-600)]/40 transition-colors disabled:opacity-50"
                                                >
                                                    {actionLoading === r.id ? "..." : "Acknowledge"}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => triage(r.id, "OPEN")}
                                                    disabled={actionLoading === r.id}
                                                    className="flex-1 py-2 rounded-lg bg-white/5 text-[var(--text-muted)] text-sm font-medium hover:bg-white/10 transition-colors disabled:opacity-50"
                                                >
                                                    Reopen
                                                </button>
                                            )}
                                            <button
                                                onClick={() => triage(r.id, "RESOLVED")}
                                                disabled={actionLoading === r.id}
                                                className="flex-1 py-2 rounded-lg bg-green-500/20 text-green-400 text-sm font-medium hover:bg-green-500/30 transition-colors disabled:opacity-50"
                                            >
                                                Resolve
                                            </button>
                                            <button
                                                onClick={() => triage(r.id, "DISMISSED")}
                                                disabled={actionLoading === r.id}
                                                className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
                                            >
                                                Dismiss
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </main>
    );
}
