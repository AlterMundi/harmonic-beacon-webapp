"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CompositePlayer } from "@/components";

interface Invite {
    id: string;
    code: string;
    maxUses: number;
    usedCount: number;
    expiresAt: string | null;
    canPublish: boolean;
    createdAt: string;
}

interface Participant {
    id: string;
    joinedAt: string;
    leftAt: string | null;
    durationSeconds: number | null;
    user: { id: string; name: string | null; email: string };
}

interface SessionDetail {
    id: string;
    title: string;
    description: string | null;
    roomName: string;
    status: string;
    scheduledAt: string | null;
    startedAt: string | null;
    endedAt: string | null;
    durationSeconds: number | null;
    egressId: string | null;
    recordingPath: string | null;
    beaconRecordingPath: string | null;
    createdAt: string;
    invites: Invite[];
    participants: Participant[];
    _count: { participants: number };
}

const statusConfig: Record<string, { label: string; color: string }> = {
    SCHEDULED: { label: "Scheduled", color: "bg-blue-500/20 text-blue-400" },
    LIVE: { label: "Live", color: "bg-green-500/20 text-green-400" },
    ENDED: { label: "Ended", color: "bg-gray-500/20 text-gray-400" },
    CANCELLED: { label: "Cancelled", color: "bg-red-500/20 text-red-400" },
};

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

export default function SessionManagePage() {
    const { id } = useParams<{ id: string }>();
    const [session, setSession] = useState<SessionDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [recordingLoading, setRecordingLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    const fetchSession = useCallback(async () => {
        try {
            const res = await fetch(`/api/provider/sessions/${id}`);
            if (!res.ok) throw new Error("Failed to load session");
            const data = await res.json();
            setSession(data.session);
        } catch {
            setError("Failed to load session");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        fetchSession();
    }, [fetchSession]);

    // Auto-refresh when session is LIVE
    useEffect(() => {
        if (session?.status !== "LIVE") return;
        const interval = setInterval(fetchSession, 10000);
        return () => clearInterval(interval);
    }, [session?.status, fetchSession]);

    const handleAction = async (action: string) => {
        setActionLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/provider/sessions/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Action failed");
            }
            await fetchSession();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Action failed");
        } finally {
            setActionLoading(false);
        }
    };

    const createInvite = async () => {
        setError(null);
        try {
            const res = await fetch(`/api/provider/sessions/${id}/invites`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to create invite");
            }
            await fetchSession();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create invite");
        }
    };

    const toggleRecording = async () => {
        if (!session) return;
        setRecordingLoading(true);
        setError(null);
        try {
            const action = session.egressId ? "stop" : "start";
            const res = await fetch(`/api/provider/sessions/${id}/recording/${action}`, {
                method: "POST",
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Recording action failed");
            }
            await fetchSession();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Recording action failed");
        } finally {
            setRecordingLoading(false);
        }
    };

    const copyInviteLink = async (code: string) => {
        const url = `${window.location.origin}/join/${code}`;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(code);
            setTimeout(() => setCopied(null), 2000);
        } catch {
            // Fallback
            const textarea = document.createElement("textarea");
            textarea.value = url;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
            setCopied(code);
            setTimeout(() => setCopied(null), 2000);
        }
    };

    if (loading) {
        return (
            <main className="pb-8 flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
            </main>
        );
    }

    if (!session) {
        return (
            <main className="pb-8 px-4 py-8 text-center">
                <p className="text-[var(--text-muted)]">Session not found</p>
                <Link href="/provider/dashboard" className="btn-secondary mt-4 inline-block">
                    Back to Dashboard
                </Link>
            </main>
        );
    }

    const sc = statusConfig[session.status] || statusConfig.SCHEDULED;

    return (
        <main className="pb-8">
            <section className="px-4 py-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-semibold truncate">{session.title}</h2>
                        {session.description && (
                            <p className="text-sm text-[var(--text-muted)] mt-1">{session.description}</p>
                        )}
                    </div>
                    <span className={`text-xs px-2.5 py-1 rounded-full flex-shrink-0 ${sc.color}`}>
                        {sc.label}
                    </span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                    <div className="stat-card">
                        <span className="stat-value text-lg">{session._count.participants}</span>
                        <p className="stat-label text-xs">Participants</p>
                    </div>
                    <div className="stat-card">
                        <span className="stat-value text-lg">{session.invites.length}</span>
                        <p className="stat-label text-xs">Invites</p>
                    </div>
                    <div className="stat-card">
                        <span className="stat-value text-lg">
                            {session.durationSeconds ? formatDuration(session.durationSeconds) : "--"}
                        </span>
                        <p className="stat-label text-xs">Duration</p>
                    </div>
                    <div className="stat-card">
                        <span className="stat-value text-lg flex items-center justify-center gap-1">
                            {session.egressId ? (
                                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
                            ) : session.recordingPath ? (
                                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                            ) : (
                                "--"
                            )}
                        </span>
                        <p className="stat-label text-xs">Recording</p>
                    </div>
                </div>

                {/* Info */}
                <div className="glass-card p-4 mb-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Room</span>
                        <span className="font-mono text-xs">{session.roomName}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Created</span>
                        <span>{formatDate(session.createdAt)}</span>
                    </div>
                    {session.scheduledAt && (
                        <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">Scheduled</span>
                            <span>{formatDate(session.scheduledAt)}</span>
                        </div>
                    )}
                    {session.startedAt && (
                        <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">Started</span>
                            <span>{formatDate(session.startedAt)}</span>
                        </div>
                    )}
                    {session.endedAt && (
                        <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">Ended</span>
                            <span>{formatDate(session.endedAt)}</span>
                        </div>
                    )}
                </div>

                {/* Recording info + player */}
                {(session.egressId || session.recordingPath) && (
                    <div className="glass-card p-4 mb-4">
                        <div className="flex items-center gap-2 mb-3">
                            {session.egressId ? (
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                            ) : (
                                <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="6" fill="currentColor" />
                                </svg>
                            )}
                            <span className="text-sm font-medium">
                                {session.egressId ? "Recording in progress" : "Recording"}
                            </span>
                        </div>
                        {session.recordingPath && !session.egressId && (
                            <CompositePlayer
                                sessionId={session.id}
                                hasSessionRecording={!!session.recordingPath}
                                hasBeaconRecording={!!session.beaconRecordingPath}
                            />
                        )}
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 mb-4">
                        {error}
                    </div>
                )}

                {/* Actions */}
                <div className="space-y-3 mb-6">
                    {session.status === "SCHEDULED" && (
                        <div className="flex gap-3">
                            <button
                                onClick={() => handleAction("start")}
                                disabled={actionLoading}
                                className="btn-primary flex-1 py-3 disabled:opacity-50"
                            >
                                <span>{actionLoading ? "Starting..." : "Start Session"}</span>
                            </button>
                            <button
                                onClick={() => handleAction("cancel")}
                                disabled={actionLoading}
                                className="btn-secondary flex-1 py-3 disabled:opacity-50 text-red-400"
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                    {session.status === "LIVE" && (
                        <>
                            <Link
                                href={`/session/${session.id}`}
                                className="btn-primary w-full py-3 block text-center"
                            >
                                <span>Join as Host</span>
                            </Link>
                            <div className="flex gap-3">
                                <button
                                    onClick={toggleRecording}
                                    disabled={recordingLoading}
                                    className={`flex-1 py-3 rounded-xl font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
                                        session.egressId
                                            ? "bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30"
                                            : "bg-white/10 border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-white/20"
                                    }`}
                                >
                                    {session.egressId && (
                                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                                    )}
                                    {recordingLoading ? "..." : session.egressId ? "Stop Recording" : "Record"}
                                </button>
                                <button
                                    onClick={() => handleAction("end")}
                                    disabled={actionLoading}
                                    className="flex-1 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 font-medium hover:bg-red-500/30 transition-all disabled:opacity-50"
                                >
                                    {actionLoading ? "Ending..." : "End Session"}
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* Invites */}
                {session.status !== "ENDED" && session.status !== "CANCELLED" && (
                    <section className="mb-6">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider">
                                Invite Links
                            </h3>
                            <button
                                onClick={createInvite}
                                className="text-xs px-3 py-1.5 rounded-full bg-[var(--primary-600)] hover:bg-[var(--primary-500)] transition-colors"
                            >
                                + New Invite
                            </button>
                        </div>
                        {session.invites.length === 0 ? (
                            <div className="glass-card p-4 text-center">
                                <p className="text-sm text-[var(--text-muted)]">
                                    No invite links yet. Create one to share with listeners.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {session.invites.map((invite) => {
                                    const isExpired = invite.expiresAt && new Date(invite.expiresAt) < new Date();
                                    const isUsedUp = invite.maxUses > 0 && invite.usedCount >= invite.maxUses;
                                    const isValid = !isExpired && !isUsedUp;
                                    return (
                                        <div
                                            key={invite.id}
                                            className={`glass-card p-3 flex items-center gap-3 ${!isValid ? "opacity-50" : ""}`}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="font-mono text-sm truncate">{invite.code}</p>
                                                <p className="text-xs text-[var(--text-muted)]">
                                                    {invite.maxUses > 0
                                                        ? `${invite.usedCount}/${invite.maxUses} uses`
                                                        : `${invite.usedCount} uses`}
                                                    {invite.expiresAt && ` · Expires ${formatDate(invite.expiresAt)}`}
                                                </p>
                                            </div>
                                            {isValid && (
                                                <button
                                                    onClick={() => copyInviteLink(invite.code)}
                                                    className="text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex-shrink-0"
                                                >
                                                    {copied === invite.code ? "Copied!" : "Copy Link"}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                )}

                {/* Participants */}
                <section>
                    <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                        Participants
                    </h3>
                    {session.participants.length === 0 ? (
                        <div className="glass-card p-4 text-center">
                            <p className="text-sm text-[var(--text-muted)]">No participants yet</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {session.participants.map((p) => (
                                <div key={p.id} className="glass-card p-3 flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium">
                                            {p.user.name || p.user.email}
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)]">
                                            Joined {formatDate(p.joinedAt)}
                                            {p.durationSeconds != null && ` · ${formatDuration(p.durationSeconds)}`}
                                        </p>
                                    </div>
                                    {!p.leftAt && session.status === "LIVE" && (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                                            Active
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </section>
        </main>
    );
}
