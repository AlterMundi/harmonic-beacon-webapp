"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

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
    rejectionReason: string | null;
    createdAt: string;
    playCount: number;
    tags: { name: string; slug: string; category: string }[];
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

    useEffect(() => {
        Promise.all([
            fetch("/api/provider/meditations").then((r) => r.json()),
            fetch("/api/provider/sessions").then((r) => r.json()),
        ])
            .then(([medData, sessData]) => {
                setMeditations(medData.meditations || []);
                setScheduledSessions(sessData.sessions || []);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    return (
        <main className="pb-8">
            {/* Stats Bar */}
            <section className="px-4 py-4">
                <div className="grid grid-cols-3 gap-3">
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
            </section>

            {/* Scheduled Sessions */}
            <section className="px-4 mb-6">
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

                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
                    </div>
                ) : meditations.length === 0 ? (
                    <div className="glass-card p-6 text-center">
                        <p className="text-[var(--text-muted)] mb-4">You haven&apos;t uploaded any meditations yet.</p>
                        <Link href="/provider/upload" className="btn-primary inline-block">
                            <span>Upload Your First</span>
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {meditations.map((m, i) => {
                            const sc = statusConfig[m.status] || statusConfig.PENDING;
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
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* FAB */}
            <Link
                href="/provider/upload"
                className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-[var(--primary-600)] to-[var(--primary-700)] flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all z-50"
                aria-label="Upload new meditation"
            >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
            </Link>
        </main>
    );
}
