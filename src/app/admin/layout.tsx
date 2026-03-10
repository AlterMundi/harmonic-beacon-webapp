"use client";

import { useRouter, usePathname } from "next/navigation";
import { BottomNav } from "@/components";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const isSubPage = pathname !== "/admin";

    return (
        <div className="min-h-screen pb-28">
            {/* Admin Header */}
            <header className="sticky top-0 z-40 backdrop-blur-lg bg-[var(--bg-dark)]/80 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-3 p-4">
                    {isSubPage && (
                        <button
                            onClick={() => router.back()}
                            aria-label="Go back"
                            className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors flex-shrink-0"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                    )}
                    <div>
                        <h1 className="font-semibold">Admin Panel</h1>
                        <p className="text-xs text-[var(--text-muted)]">Platform management</p>
                    </div>
                </div>
            </header>
            {children}
            <BottomNav />
        </div>
    );
}
