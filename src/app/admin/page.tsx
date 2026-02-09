"use client";

import { useState, useEffect } from "react";
import Link from "next/link";


interface AdminStats {
    totalUsers: number;
    totalMeditations: number;
    pendingMeditations: number;
    totalSessions: number;
    totalMinutes: number;
}

export default function AdminDashboard() {
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/admin/stats")
            .then((r) => r.json())
            .then((data) => {
                if (data.stats) setStats(data.stats);
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    const menuItems = [
        {
            title: "Moderation Queue",
            desc: "Review pending meditation submissions",
            href: "/admin/moderation",
            icon: (
                <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            ),
            alert: stats?.pendingMeditations || 0,
        },
        {
            title: "User Management",
            desc: "View and manage platform users",
            href: "/admin/users",
            icon: (
                <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
            ),
        },
        {
            title: "Tags & Categories",
            desc: "Manage content categorization tags",
            href: "/admin/tags",
            icon: (
                <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
            ),
        },
    ];

    if (loading) {
        return (
            <main className="flex justify-center py-12">
                <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
            </main>
        );
    }

    return (
        <main className="p-6">
            <h1 className="text-2xl font-bold mb-6">Platform Overview</h1>

            {/* Stats Grid */}
            <section className="grid grid-cols-2 gap-4 mb-8">
                <div className="glass-card p-4">
                    <p className="text-sm text-[var(--text-muted)]">Active Users</p>
                    <p className="text-2xl font-bold mt-1">{stats?.totalUsers || 0}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-sm text-[var(--text-muted)]">Meditations</p>
                    <p className="text-2xl font-bold mt-1">{stats?.totalMeditations || 0}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-sm text-[var(--text-muted)]">Sessions</p>
                    <p className="text-2xl font-bold mt-1">{stats?.totalSessions || 0}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-sm text-[var(--text-muted)]">Minutes Streamed</p>
                    <p className="text-2xl font-bold mt-1">{Math.round(stats?.totalMinutes || 0).toLocaleString()}</p>
                </div>
            </section>

            {/* Incomplete Modules */}
            <section>
                <h2 className="text-sm uppercase tracking-wider text-[var(--text-muted)] mb-4">Admin Tools</h2>
                <div className="space-y-4">
                    {menuItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="glass-card p-4 flex items-center gap-4 hover:bg-white/5 transition-colors group"
                        >
                            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                                {item.icon}
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold flex items-center gap-2">
                                    {item.title}
                                    {item.alert && item.alert > 0 ? (
                                        <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full animate-pulse">
                                            {item.alert}
                                        </span>
                                    ) : null}
                                </h3>
                                <p className="text-xs text-[var(--text-muted)] mt-1">{item.desc}</p>
                            </div>
                            <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                            </svg>
                        </Link>
                    ))}
                </div>
            </section>
        </main>
    );
}
