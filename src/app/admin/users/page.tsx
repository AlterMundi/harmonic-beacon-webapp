"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";

interface User {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
    role: "ADMIN" | "PROVIDER" | "LISTENER" | "USER";
    createdAt: string;
    _count: {
        meditations: number;
        sessions: number;
    };
}

export default function UserManagementPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = () => {
        fetch("/api/admin/users")
            .then((r) => r.json())
            .then((data) => {
                if (data.users) setUsers(data.users);
            })
            .finally(() => setLoading(false));
    };

    const handleRoleChange = async (userId: string, newRole: string) => {
        if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;

        setUpdating(userId);
        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: newRole }),
            });

            if (res.ok) {
                fetchUsers(); // Refresh list
            }
        } catch (error) {
            console.error("Failed to update role");
        } finally {
            setUpdating(null);
        }
    };

    const filteredUsers = users.filter(user =>
        user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <main className="pb-28 p-6">
            <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] mb-2">
                        <Link href="/admin" className="hover:text-white">Admin</Link>
                        <span>/</span>
                        <span>Users</span>
                    </div>
                    <h1 className="text-2xl font-bold">User Management</h1>
                </div>

                {/* Search */}
                <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search users..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 pr-4 py-2 bg-black/20 border border-[var(--border-subtle)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary-500)] w-full md:w-64"
                    />
                </div>
            </header>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
                </div>
            ) : (
                <div className="glass-card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-white/5 text-[var(--text-muted)] uppercase text-xs">
                                <tr>
                                    <th className="px-6 py-3 font-medium">User</th>
                                    <th className="px-6 py-3 font-medium">Role</th>
                                    <th className="px-6 py-3 font-medium">Joined</th>
                                    <th className="px-6 py-3 font-medium">Activity</th>
                                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border-subtle)]">
                                {filteredUsers.map((user) => (
                                    <tr key={user.id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-[var(--primary-700)] overflow-hidden flex-shrink-0">
                                                    {user.avatarUrl ? (
                                                        <Image src={user.avatarUrl} alt="" width={40} height={40} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-[var(--primary-300)] font-bold">
                                                            {user.name?.[0] || user.email[0].toUpperCase()}
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-white">{user.name || "Unknown"}</div>
                                                    <div className="text-[var(--text-muted)] text-xs">{user.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${user.role === 'ADMIN' ? 'bg-red-500/20 text-red-400' :
                                                    user.role === 'PROVIDER' ? 'bg-purple-500/20 text-purple-400' :
                                                        'bg-blue-500/20 text-blue-400'
                                                }`}>
                                                {user.role}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-[var(--text-muted)]">
                                            {new Date(user.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1 text-xs">
                                                <span className="text-[var(--text-secondary)]">
                                                    {user._count.sessions} sessions
                                                </span>
                                                {user.role === 'PROVIDER' && (
                                                    <span className="text-purple-400">
                                                        {user._count.meditations} uploads
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="relative inline-block text-left group">
                                                <button
                                                    disabled={updating === user.id}
                                                    className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
                                                >
                                                    <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                                                    </svg>
                                                </button>

                                                {/* Dropdown Menu */}
                                                <div className="absolute right-0 mt-2 w-48 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                                                    <div className="p-1">
                                                        <p className="px-3 py-2 text-xs text-[var(--text-muted)] border-b border-[var(--border-subtle)] mb-1">
                                                            Change Role
                                                        </p>
                                                        {['LISTENER', 'PROVIDER', 'ADMIN'].map((role) => (
                                                            <button
                                                                key={role}
                                                                onClick={() => handleRoleChange(user.id, role)}
                                                                disabled={user.role === role}
                                                                className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-white/5 ${user.role === role ? 'text-[var(--primary-500)] cursor-default' : 'text-[var(--text-secondary)]'
                                                                    }`}
                                                            >
                                                                {role}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </main>
    );
}
