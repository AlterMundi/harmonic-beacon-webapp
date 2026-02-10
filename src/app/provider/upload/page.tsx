"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface TagItem {
    id: string;
    name: string;
    slug: string;
    category: string;
}

export default function ProviderUploadPage() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [tags, setTags] = useState<TagItem[]>([]);
    const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
    const [defaultMix, setDefaultMix] = useState(0.5);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        fetch("/api/tags")
            .then((r) => r.json())
            .then((data) => {
                if (data.all) setTags(data.all);
            })
            .catch(() => {});
    }, []);

    const toggleTag = (tagId: string) => {
        setSelectedTagIds((prev) => {
            const next = new Set(prev);
            if (next.has(tagId)) next.delete(tagId);
            else next.add(tagId);
            return next;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file || !title.trim()) return;

        setSubmitting(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("title", title.trim());
            if (description.trim()) formData.append("description", description.trim());
            formData.append("tagIds", JSON.stringify(Array.from(selectedTagIds)));
            formData.append("defaultMix", String(defaultMix));

            const res = await fetch("/api/meditations/upload", {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Upload failed");
            }

            setSuccess(true);
            setTimeout(() => {
                router.push("/provider/dashboard");
            }, 1500);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Upload failed");
        } finally {
            setSubmitting(false);
        }
    };

    // Group tags by category
    const tagCategories = tags.reduce<Record<string, TagItem[]>>((acc, tag) => {
        if (!acc[tag.category]) acc[tag.category] = [];
        acc[tag.category].push(tag);
        return acc;
    }, {});

    if (success) {
        return (
            <main className="pb-8 flex items-center justify-center min-h-[60vh]">
                <div className="text-center animate-fade-in">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                        <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold mb-2">Upload Successful!</h2>
                    <p className="text-sm text-[var(--text-muted)]">Your meditation is pending review.</p>
                </div>
            </main>
        );
    }

    return (
        <main className="pb-8">
            <section className="px-4 py-4">
                <h2 className="text-xl font-semibold mb-1">Upload Meditation</h2>
                <p className="text-sm text-[var(--text-muted)] mb-6">
                    Share your guided meditation with the community
                </p>

                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* File Input */}
                    <div>
                        <label className="block text-sm font-medium mb-2">Audio File</label>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="audio/*"
                            onChange={(e) => setFile(e.target.files?.[0] || null)}
                            className="hidden"
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full glass-card p-6 text-center border-dashed hover:bg-white/5 transition-colors"
                        >
                            {file ? (
                                <div>
                                    <svg className="w-8 h-8 mx-auto mb-2 text-green-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="font-medium text-sm">{file.name}</p>
                                    <p className="text-xs text-[var(--text-muted)] mt-1">
                                        {(file.size / (1024 * 1024)).toFixed(1)} MB
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <svg className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                    </svg>
                                    <p className="text-sm text-[var(--text-muted)]">Tap to select audio file</p>
                                    <p className="text-xs text-[var(--text-muted)] mt-1">MP3, OGG, M4A, WAV</p>
                                </div>
                            )}
                        </button>
                    </div>

                    {/* Title */}
                    <div>
                        <label htmlFor="title" className="block text-sm font-medium mb-2">Title</label>
                        <input
                            id="title"
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Give your meditation a name"
                            required
                            className="input-field"
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label htmlFor="description" className="block text-sm font-medium mb-2">Description (optional)</label>
                        <textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Describe your meditation"
                            rows={3}
                            className="input-field resize-none"
                        />
                    </div>

                    {/* Default Mix */}
                    <div>
                        <label className="block text-sm font-medium mb-2">Default Beacon/Voice Mix</label>
                        <p className="text-xs text-[var(--text-muted)] mb-3">
                            Set the initial mix balance listeners will hear. Drag toward Voice for guided content, toward Beacon for ambient.
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
                        <label className="block text-sm font-medium mb-2">Tags</label>
                        {Object.entries(tagCategories).map(([category, categoryTags]) => (
                            <div key={category} className="mb-3">
                                <p className="text-xs text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">{category}</p>
                                <div className="flex flex-wrap gap-2">
                                    {categoryTags.map((tag) => (
                                        <button
                                            key={tag.id}
                                            type="button"
                                            onClick={() => toggleTag(tag.id)}
                                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                                                selectedTagIds.has(tag.id)
                                                    ? "bg-[var(--primary-600)] text-white"
                                                    : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                                            }`}
                                        >
                                            {tag.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    {/* Submit */}
                    <button
                        type="submit"
                        disabled={!file || !title.trim() || submitting}
                        className="btn-primary w-full py-4 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <span>{submitting ? "Uploading..." : "Upload Meditation"}</span>
                    </button>
                </form>
            </section>
        </main>
    );
}
