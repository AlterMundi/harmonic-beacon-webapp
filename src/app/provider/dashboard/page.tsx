"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import TakeDownDialog, { type TakeDownResponse } from "@/components/TakeDownDialog";
import { features } from "@/lib/features";

interface ProviderSession {
    id: string;
    title: string;
    status: string;
    scheduledAt: string | null;
    startedAt: string | null;
    createdAt: string;
    participantCount: number;
    durationSeconds: number | null;
}

interface ProviderMeditation {
    id: string;
    title: string;
    description: string | null;
    durationSeconds: number;
    status: string;
    isPublished: boolean;
    isFeatured: boolean;
    /**
     * True for content the Provider took down *and* for content the platform
     * hid. `takenDownAt` is what tells the two apart — see `visibilityState`.
     */
    isHidden: boolean;
    takenDownAt: string | null;
    rejectionReason: string | null;
    createdAt: string;
    playCount: number;
    tags: { name: string; slug: string; category: string }[];
}

type VisibilityState = "visible" | "takenDown" | "hiddenByPlatform";

/**
 * Which of the three states a meditation is in.
 *
 * A Provider must not be told that a moderation hide was their own doing, so
 * `isHidden` alone is not enough to label anything: hidden with a `takenDownAt`
 * is the Provider's own takedown, hidden without one is the platform having
 * acted on it (CONTENT_POLICY.md §6.2).
 */
function visibilityState(m: ProviderMeditation): VisibilityState {
    if (!m.isHidden) return "visible";
    return m.takenDownAt ? "takenDown" : "hiddenByPlatform";
}

const statusConfig: Record<string, { label: string; color: string }> = {
    APPROVED: { label: "Approved", color: "bg-green-500/20 text-green-400" },
    PENDING: { label: "Pending Review", color: "bg-yellow-500/20 text-yellow-400" },
    REJECTED: { label: "Rejected", color: "bg-red-500/20 text-red-400" },
};

const sessionStatusConfig: Record<string, { label: string; color: string }> = {
    SCHEDULED: { label: "Scheduled", color: "bg-blue-500/20 text-blue-400" },
    LIVE: { label: "Live", color: "bg-green-500/20 text-green-400" },
    ENDED: { label: "Ended", color: "bg-gray-500/20 text-gray-400" },
    CANCELLED: { label: "Cancelled", color: "bg-red-500/20 text-red-400" },
};

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

export default function ProviderDashboard() {
    const [meditations, setMeditations] = useState<ProviderMeditation[]>([]);
    const [scheduledSessions, setScheduledSessions] = useState<ProviderSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [takingDown, setTakingDown] = useState<ProviderMeditation | null>(null);

    useEffect(() => {
        Promise.all([
            fetch("/api/provider/meditations").then((r) => r.json()),
            fetch("/api/provider/sessions").then((r) => r.json()),
        ])
            .then(([medData, sessData]) => {
                setMeditations(medData.meditations || []);
                setScheduledSessions(sessData.sessions || []);
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    // Reflect the takedown in place rather than refetching: the endpoint returns
    // the row it wrote, and the dashboard is the one screen that has to show the
    // decision took effect.
    const handleTakenDown = (result: TakeDownResponse) => {
        setMeditations((prev) =>
            prev.map((m) =>
                m.id === result.meditation.id
                    ? {
                        ...m,
                        isHidden: result.meditation.isHidden,
                        isPublished: result.meditation.isPublished,
                        status: result.meditation.status,
                        takenDownAt: new Date().toISOString(),
                    }
                    : m
            )
        );
    };

    return (
        <main className="pb-8">
            {/* Header */}
            <header className="p-6 pt-8">
                <h1 className="text-3xl font-bold tracking-tight drop-shadow-md">Studio</h1>
                <p className="text-[var(--text-secondary)] text-sm mt-2 font-medium">
                    Manage your content and sessions
                </p>
            </header>

            {/* Scheduled Sessions */}
            <section className="px-4 mb-8">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider">
                        Scheduled Sessions
                    </h3>
                    <Link
                        href="/provider/sessions/new"
                        className="text-xs px-3 py-1.5 rounded-full bg-[var(--primary-600)] hover:bg-[var(--primary-500)] transition-colors"
                    >
                        + New Session
                    </Link>
                </div>

                {!loading && scheduledSessions.length === 0 ? (
                    <div className="glass-card p-4 text-center">
                        <p className="text-sm text-[var(--text-muted)] mb-3">No sessions yet</p>
                        <Link href="/provider/sessions/new" className="btn-primary inline-block text-sm">
                            <span>Create Your First Session</span>
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {scheduledSessions.slice(0, 5).map((s) => {
                            const sc = sessionStatusConfig[s.status] || sessionStatusConfig.SCHEDULED;
                            return (
                                <Link
                                    key={s.id}
                                    href={`/provider/sessions/${s.id}`}
                                    className="glass-card p-3 block hover:bg-white/5 transition-colors"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <h4 className="font-medium text-sm truncate">{s.title}</h4>
                                            <p className="text-xs text-[var(--text-muted)]">
                                                {s.participantCount} participants
                                                {s.scheduledAt && ` · ${formatDate(s.scheduledAt)}`}
                                            </p>
                                        </div>
                                        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${sc.color}`}>
                                            {sc.label}
                                        </span>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Meditation List */}
            <section className="px-4">
                <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                    Your Meditations
                </h3>

                {/* Stats Bar (Moved here) */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="stat-card">
                        <span className="stat-value text-lg">{meditations.length}</span>
                        <p className="stat-label text-xs">Total</p>
                    </div>
                    <div className="stat-card">
                        <span className="stat-value text-lg">{meditations.filter((m) => m.status === "APPROVED").length}</span>
                        <p className="stat-label text-xs">Published</p>
                    </div>
                    <div className="stat-card">
                        <span className="stat-value text-lg">{meditations.filter((m) => m.status === "PENDING").length}</span>
                        <p className="stat-label text-xs">Pending</p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
                    </div>
                ) : meditations.length === 0 ? (
                    <div className="glass-card p-6 text-center">
                        <p className="text-[var(--text-muted)] mb-4">You haven&apos;t uploaded any meditations yet.</p>
                        {/* Upload is hidden in the first iteration (WS0). Re-enabled by
                            NEXT_PUBLIC_SHOW_UPLOAD. */}
                        {features.showUpload && (
                            <Link href="/provider/upload" className="btn-primary inline-block">
                                <span>Upload Your First</span>
                            </Link>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {meditations.map((m, i) => {
                            const sc = statusConfig[m.status] || statusConfig.PENDING;
                            const visibility = visibilityState(m);
                            return (
                                <div
                                    key={m.id}
                                    className="glass-card p-4 animate-fade-in"
                                    style={{ opacity: 0, animationDelay: `${i * 0.05}s` }}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <h4 className="font-semibold truncate">{m.title}</h4>
                                            {m.description && (
                                                <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{m.description}</p>
                                            )}
                                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${sc.color}`}>
                                                    {sc.label}
                                                </span>
                                                {visibility === "takenDown" && (
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">
                                                        {m.isPublished ? "Taken down by you" : "Withdrawn by you"}
                                                    </span>
                                                )}
                                                {visibility === "hiddenByPlatform" && (
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                                                        Hidden by moderation
                                                    </span>
                                                )}
                                                {m.durationSeconds > 0 && (
                                                    <span className="text-xs text-[var(--text-muted)]">
                                                        {formatDuration(m.durationSeconds)}
                                                    </span>
                                                )}
                                                <span className="text-xs text-[var(--text-muted)]">
                                                    {formatDate(m.createdAt)}
                                                </span>
                                                {m.playCount > 0 && (
                                                    <span className="text-xs text-[var(--text-muted)]">
                                                        {m.playCount} plays
                                                    </span>
                                                )}
                                            </div>
                                            {m.tags.length > 0 && (
                                                <div className="flex gap-1.5 mt-2 flex-wrap">
                                                    {m.tags.map((t) => (
                                                        <span
                                                            key={t.slug}
                                                            className="text-xs px-1.5 py-0.5 rounded bg-[var(--primary-700)]/30 text-[var(--primary-300)]"
                                                        >
                                                            {t.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {m.status === "REJECTED" && m.rejectionReason && (
                                                <p className="text-xs text-red-400 mt-2">
                                                    Reason: {m.rejectionReason}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            {m.isFeatured && (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-500)]/20 text-[var(--accent-400)] flex-shrink-0">
                                                    Featured
                                                </span>
                                            )}
                                            <Link
                                                href={`/provider/edit/${m.id}`}
                                                className="text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center gap-1"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                Edit
                                            </Link>
                                            {/*
                                              * Offered only where it would do something. Content the
                                              * platform hid is already out of the catalogue and is not
                                              * the Provider's to act on, and content already taken down
                                              * cannot be taken down twice.
                                              */}
                                            {visibility === "visible" && (
                                                <button
                                                    type="button"
                                                    onClick={() => setTakingDown(m)}
                                                    aria-label={`${m.isPublished ? "Take down" : "Withdraw from review"}: ${m.title}`}
                                                    className="text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-red-500/20 hover:text-red-400 transition-colors flex items-center gap-1"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                                                    {m.isPublished ? "Take down" : "Withdraw"}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {takingDown && (
                <TakeDownDialog
                    meditationId={takingDown.id}
                    meditationTitle={takingDown.title}
                    isPublished={takingDown.isPublished}
                    onClose={() => setTakingDown(null)}
                    onTakenDown={handleTakenDown}
                />
            )}
        </main>
    );
}
