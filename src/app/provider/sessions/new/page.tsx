"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewSessionPage() {
    const router = useRouter();
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [scheduledAt, setScheduledAt] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;

        setSubmitting(true);
        setError(null);

        try {
            const body: Record<string, string> = { title: title.trim() };
            if (description.trim()) body.description = description.trim();
            if (scheduledAt) body.scheduledAt = new Date(scheduledAt).toISOString();

            const res = await fetch("/api/provider/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to create session");
            }

            const data = await res.json();
            router.push(`/provider/sessions/${data.session.id}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create session");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="pb-8">
            <section className="px-4 py-4">
                <h2 className="text-xl font-semibold mb-1">New Session</h2>
                <p className="text-sm text-[var(--text-muted)] mb-6">
                    Create a live audio session for your listeners
                </p>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label htmlFor="title" className="block text-sm font-medium mb-2">Title</label>
                        <input
                            id="title"
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Give your session a name"
                            required
                            className="input-field"
                        />
                    </div>

                    <div>
                        <label htmlFor="description" className="block text-sm font-medium mb-2">Description (optional)</label>
                        <textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What will this session be about?"
                            rows={3}
                            className="input-field resize-none"
                        />
                    </div>

                    <div>
                        <label htmlFor="scheduledAt" className="block text-sm font-medium mb-2">Schedule For (optional)</label>
                        <input
                            id="scheduledAt"
                            type="datetime-local"
                            value={scheduledAt}
                            onChange={(e) => setScheduledAt(e.target.value)}
                            className="input-field"
                        />
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                            Leave empty to start the session manually
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={!title.trim() || submitting}
                        className="btn-primary w-full py-4 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <span>{submitting ? "Creating..." : "Create Session"}</span>
                    </button>
                </form>
            </section>
        </main>
    );
}
