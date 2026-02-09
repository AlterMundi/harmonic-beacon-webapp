"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { CompositePlayer } from "@/components";
import type { RecordingTrack } from "@/components/CompositePlayer";

interface SessionMeta {
    id: string;
    title: string;
    description: string | null;
    providerName: string | null;
    durationSeconds: number | null;
    startedAt: string | null;
    endedAt: string | null;
    recordings: RecordingTrack[];
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

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins >= 60) {
        const hours = Math.floor(mins / 60);
        const remainMins = mins % 60;
        return `${hours}h ${remainMins}m`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function PlaybackPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [session, setSession] = useState<SessionMeta | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const res = await fetch(`/api/sessions/${id}`);
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || "Failed to load session");
                }
                const data = await res.json();
                setSession(data.session);
            } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to load session");
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [id]);

    if (loading) {
        return (
            <main className="pb-8 flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
            </main>
        );
    }

    if (error || !session) {
        return (
            <main className="pb-8 px-4 py-8 text-center">
                <p className="text-[var(--text-muted)]">{error || "Session not found"}</p>
                <button
                    onClick={() => router.push("/sessions")}
                    className="btn-secondary mt-4 inline-block"
                >
                    Back to Sessions
                </button>
            </main>
        );
    }

    const hasBeacon = session.recordings.some((r) => r.category === "BEACON");

    return (
        <main className="pb-8">
            <section className="px-4 py-4">
                {/* Back button */}
                <button
                    onClick={() => router.push("/sessions")}
                    className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors mb-4"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    Sessions
                </button>

                {/* Session info */}
                <div className="mb-6">
                    <h2 className="text-xl font-semibold">{session.title}</h2>
                    {session.description && (
                        <p className="text-sm text-[var(--text-muted)] mt-1">{session.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-sm text-[var(--text-muted)]">
                        {session.providerName && <span>{session.providerName}</span>}
                        {session.durationSeconds && (
                            <>
                                <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]"></span>
                                <span>{formatDuration(session.durationSeconds)}</span>
                            </>
                        )}
                        {session.endedAt && (
                            <>
                                <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]"></span>
                                <span>{formatDate(session.endedAt)}</span>
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        {hasBeacon && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-500)]/20 text-[var(--accent-400)]">
                                +Beacon
                            </span>
                        )}
                        {session.recordings.length > 1 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary-500)]/20 text-[var(--primary-400)]">
                                {session.recordings.length} tracks
                            </span>
                        )}
                    </div>
                </div>

                {/* Player */}
                <CompositePlayer
                    sessionId={session.id}
                    recordings={session.recordings}
                />
            </section>
        </main>
    );
}
