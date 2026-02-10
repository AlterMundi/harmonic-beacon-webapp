"use client";

import { useState, useEffect } from "react";

interface TagItem {
    id: string;
    name: string;
    slug: string;
}

interface CutDialogProps {
    sessionId: string;
    inSeconds: number;
    outSeconds: number;
    mix: number;
    onClose: () => void;
    onSuccess: () => void;
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function CutDialog({
    sessionId,
    inSeconds,
    outSeconds,
    mix,
    onClose,
    onSuccess,
}: CutDialogProps) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [tagsByCategory, setTagsByCategory] = useState<Record<string, TagItem[]>>({});
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/tags")
            .then((res) => res.json())
            .then((data) => {
                if (data.tags) setTagsByCategory(data.tags);
            })
            .catch(() => {});
    }, []);

    const toggleTag = (tagId: string) => {
        setSelectedTags((prev) => {
            const next = new Set(prev);
            if (next.has(tagId)) next.delete(tagId);
            else next.add(tagId);
            return next;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;

        setSubmitting(true);
        setError(null);

        try {
            const res = await fetch(`/api/provider/sessions/${sessionId}/cuts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    inSeconds,
                    outSeconds,
                    mix,
                    title: title.trim(),
                    description: description.trim() || undefined,
                    tagIds: Array.from(selectedTags),
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to create cut");
            }

            onSuccess();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create cut");
        } finally {
            setSubmitting(false);
        }
    };

    const duration = outSeconds - inSeconds;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <div className="glass-card w-full max-w-lg rounded-t-2xl p-5 animate-slide-up max-h-[85vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Create Meditation Cut</h3>
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Selection info */}
                <div className="flex gap-3 mb-4 text-sm">
                    <div className="stat-card flex-1">
                        <span className="stat-value text-sm">{formatTime(inSeconds)}</span>
                        <p className="stat-label text-xs">In</p>
                    </div>
                    <div className="stat-card flex-1">
                        <span className="stat-value text-sm">{formatTime(outSeconds)}</span>
                        <p className="stat-label text-xs">Out</p>
                    </div>
                    <div className="stat-card flex-1">
                        <span className="stat-value text-sm">{formatTime(duration)}</span>
                        <p className="stat-label text-xs">Duration</p>
                    </div>
                </div>

                {/* Mix info */}
                <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-white/5 border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
                    <svg className="w-4 h-4 flex-shrink-0 text-[var(--primary-400)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>
                        Mix ratio ({Math.round(mix * 100)}% voice) will be the default for listeners
                    </span>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Title */}
                    <div>
                        <label className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                            Title
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Meditation title"
                            required
                            disabled={submitting}
                            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-[var(--border-subtle)] text-sm focus:outline-none focus:border-[var(--primary-500)] transition-colors disabled:opacity-50"
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                            Description
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional description"
                            rows={2}
                            disabled={submitting}
                            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-[var(--border-subtle)] text-sm focus:outline-none focus:border-[var(--primary-500)] transition-colors resize-none disabled:opacity-50"
                        />
                    </div>

                    {/* Tags */}
                    {Object.keys(tagsByCategory).length > 0 && (
                        <div>
                            <label className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                                Tags
                            </label>
                            <div className="space-y-3">
                                {Object.entries(tagsByCategory).map(([category, tags]) => (
                                    <div key={category}>
                                        <p className="text-xs text-[var(--text-muted)] mb-1">{category}</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {tags.map((tag) => (
                                                <button
                                                    key={tag.id}
                                                    type="button"
                                                    onClick={() => toggleTag(tag.id)}
                                                    disabled={submitting}
                                                    className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                                                        selectedTags.has(tag.id)
                                                            ? "bg-[var(--primary-600)] text-white"
                                                            : "bg-white/10 text-[var(--text-secondary)] hover:bg-white/20"
                                                    } disabled:opacity-50`}
                                                >
                                                    {tag.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    {/* Submit */}
                    <button
                        type="submit"
                        disabled={submitting || !title.trim()}
                        className="btn-primary w-full py-3 disabled:opacity-50"
                    >
                        {submitting ? "Rendering mixdown..." : "Create Cut"}
                    </button>
                </form>
            </div>
        </div>
    );
}
