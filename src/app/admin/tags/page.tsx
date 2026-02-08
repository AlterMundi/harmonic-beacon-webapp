"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Tag {
    id: string;
    name: string;
    slug: string;
    category: string;
}

const CATEGORIES = ["MOOD", "TECHNIQUE", "DURATION", "LANGUAGE"];

export default function TagManagementPage() {
    const [tags, setTags] = useState<Tag[]>([]);
    const [loading, setLoading] = useState(true);
    const [newTagName, setNewTagName] = useState("");
    const [newTagCategory, setNewTagCategory] = useState(CATEGORIES[0]);
    const [creating, setCreating] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    useEffect(() => {
        fetchTags();
    }, []);

    const fetchTags = () => {
        setLoading(true);
        fetch("/api/tags") // Use public endpoint to read
            .then((r) => r.json())
            .then((data) => {
                if (data.all) setTags(data.all);
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    };

    const handleCreateTag = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTagName.trim()) return;

        setCreating(true);
        try {
            const res = await fetch("/api/admin/tags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: newTagName,
                    category: newTagCategory,
                }),
            });

            if (res.ok) {
                setNewTagName("");
                fetchTags();
            }
        } catch (error) {
            console.error("Failed to create tag");
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteTag = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent card click if any
        if (!confirm("Are you sure? This tag will be removed from all meditations.")) return;

        setDeleting(id);
        try {
            const res = await fetch(`/api/admin/tags?id=${id}`, {
                method: "DELETE",
            });

            if (res.ok) {
                setTags((prev) => prev.filter((t) => t.id !== id));
            }
        } catch (error) {
            console.error("Failed to delete tag");
        } finally {
            setDeleting(null);
        }
    };

    // Group tags by category
    const groupedTags = tags.reduce<Record<string, Tag[]>>((acc, tag) => {
        if (!acc[tag.category]) acc[tag.category] = [];
        acc[tag.category].push(tag);
        return acc;
    }, {});

    return (
        <main className="pb-28 p-6">
            <header className="mb-6">
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] mb-2">
                    <Link href="/admin" className="hover:text-white">Admin</Link>
                    <span>/</span>
                    <span>Tags</span>
                </div>
                <h1 className="text-2xl font-bold">Tag Management</h1>
                <p className="text-[var(--text-secondary)] text-sm">Organize content categorization</p>
            </header>

            {/* Create Tag Form */}
            <section className="glass-card p-6 mb-8">
                <h2 className="text-lg font-semibold mb-4">Add New Tag</h2>
                <form onSubmit={handleCreateTag} className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="flex-1 w-full">
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Name</label>
                        <input
                            type="text"
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            placeholder="e.g., Deep Focus"
                            className="w-full bg-black/20 border border-[var(--border-subtle)] rounded-lg p-2 focus:border-[var(--primary-500)] outline-none"
                            required
                        />
                    </div>
                    <div className="w-full md:w-48">
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Category</label>
                        <select
                            value={newTagCategory}
                            onChange={(e) => setNewTagCategory(e.target.value)}
                            className="w-full bg-black/20 border border-[var(--border-subtle)] rounded-lg p-2 focus:border-[var(--primary-500)] outline-none"
                        >
                            {CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>
                                    {cat}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="submit"
                        disabled={creating || !newTagName}
                        className="btn-primary w-full md:w-auto"
                    >
                        {creating ? "Adding..." : "Add Tag"}
                    </button>
                </form>
            </section>

            {/* Tag List */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
                </div>
            ) : (
                <div className="grid gap-6 md:grid-cols-2">
                    {CATEGORIES.map((category) => (
                        <div key={category} className="glass-card p-4 h-full">
                            <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--border-subtle)]">
                                <h3 className="font-semibold text-[var(--text-muted)] text-sm">
                                    {category}{" "}
                                    <span className="text-xs font-normal">
                                        ({(groupedTags[category] || []).length})
                                    </span>
                                </h3>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {(groupedTags[category] || []).length === 0 ? (
                                    <p className="text-sm text-[var(--text-muted)] italic w-full text-center py-4">
                                        No tags in this category
                                    </p>
                                ) : (
                                    groupedTags[category].map((tag) => (
                                        <div
                                            key={tag.id}
                                            className="group flex items-center gap-2 pl-3 pr-1 py-1 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] text-sm hover:border-[var(--primary-500)]/30 transition-colors"
                                        >
                                            <span className="text-[var(--text-secondary)]">{tag.name}</span>
                                            <button
                                                onClick={(e) => handleDeleteTag(tag.id, e)}
                                                disabled={deleting === tag.id}
                                                className="p-1 rounded-full hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 opacity-60 group-hover:opacity-100 transition-all"
                                                title="Delete tag"
                                            >
                                                {deleting === tag.id ? (
                                                    <div className="w-3.5 h-3.5 border-2 border-red-500/50 border-t-red-500 rounded-full animate-spin"></div>
                                                ) : (
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                )}
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </main>
    );
}
