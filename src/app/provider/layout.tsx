import Link from "next/link";

export default function ProviderLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen">
            {/* Provider Header */}
            <header className="sticky top-0 z-40 backdrop-blur-lg bg-[var(--bg-dark)]/80 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-3 p-4">
                    <Link
                        href="/profile"
                        className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                    </Link>
                    <div>
                        <h1 className="font-semibold">Provider Studio</h1>
                        <p className="text-xs text-[var(--text-muted)]">Manage your meditations</p>
                    </div>
                </div>
            </header>
            {children}
        </div>
    );
}
