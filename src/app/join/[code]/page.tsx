"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

interface SessionInfo {
    id: string;
    title: string;
    description: string | null;
    status: string;
    scheduledAt: string | null;
    providerName: string | null;
    participantCount: number;
}

export default function JoinPage() {
    const { code } = useParams<{ code: string }>();
    const router = useRouter();
    const [session, setSession] = useState<SessionInfo | null>(null);
    const [inviteCode, setInviteCode] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch(`/api/invites/${code}`)
            .then(async (res) => {
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || "Invalid invite");
                }
                return res.json();
            })
            .then((data) => {
                setSession(data.session);
                setInviteCode(data.invite.code);
            })
            .catch((e) => {
                setError(e instanceof Error ? e.message : "Invalid invite");
            })
            .finally(() => setLoading(false));
    }, [code]);

    const handleJoin = () => {
        if (!session) return;
        router.push(`/session/${session.id}?invite=${inviteCode}`);
    };

    if (loading) {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
            </main>
        );
    }

    if (error) {
        return (
            <main className="min-h-screen flex items-center justify-center px-4">
                <div className="glass-card p-8 text-center max-w-sm w-full">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                        <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold mb-2">Invalid Invite</h2>
                    <p className="text-sm text-[var(--text-muted)]">{error}</p>
                </div>
            </main>
        );
    }

    if (!session) return null;

    return (
        <main className="min-h-screen flex items-center justify-center px-4">
            <div className="glass-card p-8 max-w-sm w-full animate-fade-in">
                <div className="text-center mb-6">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-[var(--primary-600)] to-[var(--primary-800)] flex items-center justify-center">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold mb-1">{session.title}</h2>
                    {session.description && (
                        <p className="text-sm text-[var(--text-muted)] mb-2">{session.description}</p>
                    )}
                </div>

                <div className="space-y-2 mb-6 text-sm">
                    {session.providerName && (
                        <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">Host</span>
                            <span>{session.providerName}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Status</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                            session.status === "LIVE"
                                ? "bg-green-500/20 text-green-400"
                                : "bg-blue-500/20 text-blue-400"
                        }`}>
                            {session.status === "LIVE" ? "Live Now" : "Scheduled"}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Participants</span>
                        <span>{session.participantCount}</span>
                    </div>
                    {session.scheduledAt && (
                        <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">Scheduled</span>
                            <span>
                                {new Date(session.scheduledAt).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                })}
                            </span>
                        </div>
                    )}
                </div>

                {session.status === "LIVE" ? (
                    <button
                        onClick={handleJoin}
                        className="btn-primary w-full py-4"
                    >
                        Join Session
                    </button>
                ) : (
                    <div className="text-center">
                        <p className="text-sm text-[var(--text-muted)] mb-3">
                            This session hasn&apos;t started yet. Check back when the host goes live.
                        </p>
                        <button
                            disabled
                            className="btn-secondary w-full py-4 opacity-50 cursor-not-allowed"
                        >
                            Waiting for Host
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
