import { BottomNav } from "@/components";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen pb-28">
            {/* Admin Header */}
            <header className="sticky top-0 z-40 backdrop-blur-lg bg-[var(--bg-dark)]/80 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-3 p-4">
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
