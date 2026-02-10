"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";

interface TagItem {
    id: string;
    name: string;
    slug: string;
    category: string;
}

export default function EditMeditationPage() {
    const router = useRouter();
    const params = useParams();
    const { data: session } = useSession();

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [status, setStatus] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [defaultMix, setDefaultMix] = useState(0.5);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [allTags, setAllTags] = useState<TagItem[]>([]);
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

    // Fetch initial data
    useEffect(() => {
        // Fetch tags
        fetch("/api/tags")
            .then((r) => r.json())
            .then((data) => {
                if (data.all) setAllTags(data.all);
            });

        // Fetch meditation details
        if (params.id) {
            fetch(`/api/provider/meditations/${params.id}`)
                .then(async (r) => {
                    if (!r.ok) throw new Error("Failed to load meditation");
                    const data = await r.json();
                    const m = data.meditation;

                    setTitle(m.title);
                    setDescription(m.description || "");
                    setStatus(m.status);
                    setDefaultMix(m.defaultMix ?? 0.5);

                    // Set selected tags
                    const tagIds = new Set<string>(m.tags.map((t: { id: string }) => t.id));
                    setSelectedTags(tagIds);

                    setLoading(false);
                })
                .catch((e) => {
                    setError(e.message);
                    setLoading(false);
                });
        }
    }, [params.id]);

    const toggleTag = (tagId: string) => {
        setSelectedTags((prev) => {
            const next = new Set(prev);
            if (next.has(tagId)) next.delete(tagId);
            else {
                if (next.size >= 5) return prev; // Max 5 tags
                next.add(tagId);
            }
            return next;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title) return;

        setSaving(true);
        setError(null);

        try {
            const res = await fetch(`/api/provider/meditations/${params.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title,
                    description,
                    defaultMix,
                    tagIds: Array.from(selectedTags),
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to update meditation");
            }

            router.push("/provider/dashboard");
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
            setSaving(false);
        }
    };

    const groupedTags = allTags.reduce<Record<string, TagItem[]>>((acc, tag) => {
        if (!acc[tag.category]) acc[tag.category] = [];
        acc[tag.category].push(tag);
        return acc;
    }, {});

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4">
                <div className="glass-card p-6 text-center">
                    <p className="text-red-400 mb-4">{error}</p>
                    <Link href="/provider/dashboard" className="btn-secondary">
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <main className="pb-28 p-6">
            <header className="mb-8">
                <Link href="/provider/dashboard" className="text-sm text-[var(--text-muted)] hover:text-white flex items-center gap-2 mb-4">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                    Back to Studio
                </Link>
                <h1 className="text-2xl font-bold">Edit Meditation</h1>
                <p className="text-[var(--text-secondary)]">Update details for &quot;{title}&quot;</p>
                {status === 'APPROVED' && (
                    <div className="mt-2 text-xs bg-yellow-500/10 text-yellow-400 px-3 py-1 rounded inline-block">
                        Note: Significant changes may require re-approval
                    </div>
                )}
            </header>

            <form onSubmit={handleSubmit} className="glass-card p-6 space-y-6">
                {/* Title */}
                <div>
                    <label className="block text-sm font-medium mb-2">Title</label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full bg-black/20 border border-[var(--border-subtle)] rounded-lg p-3 focus:border-[var(--primary-500)] outline-none"
                        placeholder="e.g., Morning Calm"
                        required
                    />
                </div>

                {/* Description */}
                <div>
                    <label className="block text-sm font-medium mb-2">Description</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full bg-black/20 border border-[var(--border-subtle)] rounded-lg p-3 focus:border-[var(--primary-500)] outline-none h-32"
                        placeholder="Describe the meditation..."
                    />
                </div>

                {/* Default Mix */}
                <div>
                    <label className="block text-sm font-medium mb-2">Default Beacon/Voice Mix</label>
                    <p className="text-xs text-[var(--text-muted)] mb-3">
                        Set the initial mix balance listeners will hear.
                    </p>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-[var(--text-muted)]">Beacon</span>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={defaultMix}
                            onChange={(e) => setDefaultMix(parseFloat(e.target.value))}
                            aria-label="Default beacon/voice mix"
                            className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                        />
                        <span className="text-xs text-[var(--text-muted)]">Voice</span>
                    </div>
                </div>

                {/* Tags */}
                <div>
                    <label className="block text-sm font-medium mb-3">
                        Tags <span className="text-[var(--text-muted)] font-normal ml-1">({selectedTags.size}/5)</span>
                    </label>
                    <div className="space-y-4">
                        {Object.entries(groupedTags).map(([category, tags]) => (
                            <div key={category}>
                                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">{category}</p>
                                <div className="flex flex-wrap gap-2">
                                    {tags.map((tag) => (
                                        <button
                                            key={tag.id}
                                            type="button"
                                            onClick={() => toggleTag(tag.id)}
                                            className={`px-3 py-1.5 rounded-full text-sm transition-all ${selectedTags.has(tag.id)
                                                ? "bg-[var(--primary-600)] text-white shadow-lg shadow-[var(--primary-900)]/20"
                                                : "bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-white/5"
                                                }`}
                                        >
                                            {tag.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Submit */}
                <button
                    type="submit"
                    disabled={saving || !title}
                    className="w-full btn-primary py-4 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {saving ? (
                        <span className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Saving...
                        </span>
                    ) : (
                        "Save Changes"
                    )}
                </button>
            </form>
        </main>
    );
}
