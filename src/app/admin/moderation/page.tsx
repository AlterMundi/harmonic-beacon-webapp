"use client";

import { useState, useEffect, useCallback } from "react";

interface AdminMeditation {
    id: string;
    title: string;
    description: string | null;
    durationSeconds: number;
    streamName: string;
    status: string;
    isPublished: boolean;
    isFeatured: boolean;
    rejectionReason: string | null;
    createdAt: string;
    reviewedAt: string | null;
    provider: { name: string | null; email: string } | null;
    tags: { name: string; slug: string; category: string }[];
}

const tabs = ["PENDING", "APPROVED", "REJECTED"] as const;

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

export default function AdminModerationPage() {
    const [activeTab, setActiveTab] = useState<string>("PENDING");
    const [meditations, setMeditations] = useState<AdminMeditation[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState("");

    const fetchMeditations = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/meditations?status=${activeTab}`);
            if (res.ok) {
                const data = await res.json();
                setMeditations(data.meditations || []);
            }
        } catch {
            // Silently fail
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    useEffect(() => {
        fetchMeditations();
    }, [fetchMeditations]);

    const handleApprove = async (id: string) => {
        setActionLoading(id);
        try {
            const res = await fetch(`/api/admin/meditations/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "APPROVED" }),
            });
            if (res.ok) {
                setMeditations((prev) => prev.filter((m) => m.id !== id));
            }
        } catch {
            // Silently fail
        } finally {
            setActionLoading(null);
        }
    };

    const handleReject = async (id: string) => {
        setActionLoading(id);
        try {
            const res = await fetch(`/api/admin/meditations/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status: "REJECTED",
                    rejectionReason: rejectReason.trim() || undefined,
                }),
            });
            if (res.ok) {
                setMeditations((prev) => prev.filter((m) => m.id !== id));
                setRejectingId(null);
                setRejectReason("");
            }
        } catch {
            // Silently fail
        } finally {
            setActionLoading(null);
        }
    };

    const handleToggleFeatured = async (id: string, currentFeatured: boolean) => {
        setActionLoading(id);
        try {
            const res = await fetch(`/api/admin/meditations/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "APPROVED", isFeatured: !currentFeatured }),
            });
            if (res.ok) {
                setMeditations((prev) =>
                    prev.map((m) => (m.id === id ? { ...m, isFeatured: !currentFeatured } : m))
                );
            }
        } catch {
            // Silently fail
        } finally {
            setActionLoading(null);
        }
    };

    return (
        <main className="pb-8">
            {/* Tab Filter */}
            <section className="px-4 py-4">
                <div className="flex gap-2">
                    {tabs.map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                                activeTab === tab
                                    ? "bg-[var(--primary-600)] text-white"
                                    : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                            }`}
                        >
                            {tab === "PENDING" ? "Pending" : tab === "APPROVED" ? "Approved" : "Rejected"}
                        </button>
                    ))}
                </div>
            </section>

            {/* Meditation List */}
            <section className="px-4">
                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
                    </div>
                ) : meditations.length === 0 ? (
                    <div className="glass-card p-6 text-center">
                        <p className="text-[var(--text-muted)]">
                            {activeTab === "PENDING"
                                ? "No meditations awaiting review"
                                : `No ${activeTab.toLowerCase()} meditations`}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {meditations.map((m, i) => (
                            <div
                                key={m.id}
                                className="glass-card p-4 animate-fade-in"
                                style={{ opacity: 0, animationDelay: `${i * 0.05}s` }}
                            >
                                {/* Info */}
                                <div className="mb-3">
                                    <h4 className="font-semibold">{m.title}</h4>
                                    {m.description && (
                                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{m.description}</p>
                                    )}
                                    <div className="flex items-center gap-2 mt-2 flex-wrap text-xs text-[var(--text-muted)]">
                                        <span>{m.provider?.name || m.provider?.email || "Unknown"}</span>
                                        <span>-</span>
                                        <span>{formatDate(m.createdAt)}</span>
                                        {m.durationSeconds > 0 && (
                                            <>
                                                <span>-</span>
                                                <span>{formatDuration(m.durationSeconds)}</span>
                                            </>
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
                                    {m.rejectionReason && (
                                        <p className="text-xs text-red-400 mt-2">Reason: {m.rejectionReason}</p>
                                    )}
                                </div>

                                {/* Audio Preview */}
                                <audio
                                    controls
                                    preload="none"
                                    src={`/api/admin/meditations/${m.id}/audio`}
                                    className="w-full h-8 mt-2"
                                />

                                {/* Actions */}
                                {activeTab === "PENDING" && (
                                    <div className="flex gap-2 pt-3 border-t border-[var(--border-subtle)]">
                                        <button
                                            onClick={() => handleApprove(m.id)}
                                            disabled={actionLoading === m.id}
                                            className="flex-1 py-2 rounded-lg bg-green-500/20 text-green-400 text-sm font-medium hover:bg-green-500/30 transition-colors disabled:opacity-50"
                                        >
                                            {actionLoading === m.id ? "..." : "Approve"}
                                        </button>
                                        {rejectingId === m.id ? (
                                            <div className="flex-1 flex flex-col gap-2">
                                                <input
                                                    type="text"
                                                    value={rejectReason}
                                                    onChange={(e) => setRejectReason(e.target.value)}
                                                    placeholder="Reason (optional)"
                                                    className="input-field text-xs py-2"
                                                />
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleReject(m.id)}
                                                        disabled={actionLoading === m.id}
                                                        className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
                                                    >
                                                        Confirm
                                                    </button>
                                                    <button
                                                        onClick={() => { setRejectingId(null); setRejectReason(""); }}
                                                        className="flex-1 py-2 rounded-lg bg-white/5 text-[var(--text-muted)] text-xs font-medium hover:bg-white/10 transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setRejectingId(m.id)}
                                                className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/30 transition-colors"
                                            >
                                                Reject
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Featured toggle for approved */}
                                {activeTab === "APPROVED" && (
                                    <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)]">
                                        <span className="text-sm text-[var(--text-secondary)]">Featured</span>
                                        <button
                                            onClick={() => handleToggleFeatured(m.id, m.isFeatured)}
                                            disabled={actionLoading === m.id}
                                            className={`w-11 h-6 rounded-full transition-colors relative ${
                                                m.isFeatured ? "bg-[var(--accent-500)]" : "bg-white/10"
                                            }`}
                                        >
                                            <div
                                                className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
                                                    m.isFeatured ? "translate-x-5" : "translate-x-0.5"
                                                }`}
                                            />
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </main>
    );
}
