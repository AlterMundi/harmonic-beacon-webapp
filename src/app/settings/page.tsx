"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import DeleteAccountDialog from "@/components/DeleteAccountDialog";

const LANGUAGE_STORAGE_KEY = "app_language";

const LANGUAGES = [
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
];

export default function SettingsPage() {
    const router = useRouter();
    // Lazy initializer reads localStorage synchronously on first render (SSR-safe)
    const [language, setLanguage] = useState<string>(() => {
        if (typeof window === "undefined") return "en";
        return localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? "en";
    });
    const [exporting, setExporting] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    // Sync the HTML lang attribute whenever language changes
    useEffect(() => {
        document.documentElement.lang = language;
    }, [language]);

    const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newLang = e.target.value;
        setLanguage(newLang);
        localStorage.setItem(LANGUAGE_STORAGE_KEY, newLang);
        document.documentElement.lang = newLang;
    };

    const handleExport = async () => {
        setExporting(true);
        try {
            const res = await fetch("/api/users/me/export");
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to export account data");
            }

            const disposition = res.headers.get("Content-Disposition") ?? "";
            const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
            const filename = filenameMatch?.[1] ?? "harmonic-beacon-export.json";

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to export account data");
        } finally {
            setExporting(false);
        }
    };

    return (
        <main className="min-h-screen pb-28">
            {/* Header */}
            <header className="sticky top-0 z-40 backdrop-blur-lg bg-[var(--bg-dark)]/80 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-3 p-4">
                    <button
                        onClick={() => router.back()}
                        aria-label="Go back"
                        className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div>
                        <h1 className="font-semibold">App Settings</h1>
                        <p className="text-xs text-[var(--text-muted)]">Preferences &amp; Config</p>
                    </div>
                </div>
            </header>

            <div className="p-4 space-y-6">
                {/* General Preferences */}
                <section>
                    <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                        General
                    </h3>
                    <div className="glass-card overflow-hidden">
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <span className="text-sm font-medium">Language</span>
                                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                    {LANGUAGES.find(l => l.value === language)?.label ?? "English"}
                                </p>
                            </div>
                            <select
                                value={language}
                                onChange={handleLanguageChange}
                                aria-label="Select language"
                                className="bg-transparent text-sm text-[var(--text-secondary)] focus:outline-none cursor-pointer"
                            >
                                {LANGUAGES.map((l) => (
                                    <option key={l.value} value={l.value} className="bg-[var(--bg-dark)]">
                                        {l.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </section>

                {/* Your Data */}
                <section>
                    <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                        Your Data
                    </h3>
                    <div className="glass-card overflow-hidden divide-y divide-[var(--border-subtle)]">
                        <div className="p-4 flex items-center justify-between gap-4">
                            <div>
                                <span className="text-sm font-medium">Export your data</span>
                                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                    Download everything we hold about your account as a JSON file
                                </p>
                            </div>
                            <button
                                onClick={handleExport}
                                disabled={exporting}
                                className="btn-secondary whitespace-nowrap disabled:opacity-50"
                            >
                                {exporting ? "Exporting..." : "Export"}
                            </button>
                        </div>
                        <div className="p-4 flex items-center justify-between gap-4">
                            <div>
                                <span className="text-sm font-medium text-red-400">Delete account</span>
                                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                    Permanently remove your personal data from Harmonic Beacon
                                </p>
                            </div>
                            <button
                                onClick={() => setShowDeleteDialog(true)}
                                aria-label="Delete account"
                                className="whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-medium border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </section>

                {/* About */}
                <section>
                    <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                        About
                    </h3>
                    <div className="glass-card p-4 text-center">
                        <p className="text-sm font-medium">Harmonic Beacon</p>
                        <p className="text-xs text-[var(--text-muted)] mt-1">Version 1.0.0 (Alpha)</p>
                        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                            <a href="#" className="text-xs text-[var(--primary-400)] hover:underline">Privacy Policy</a>
                            <span className="text-[var(--text-muted)] mx-2">·</span>
                            <a href="#" className="text-xs text-[var(--primary-400)] hover:underline">Terms of Service</a>
                        </div>
                    </div>
                </section>
            </div>

            {showDeleteDialog && (
                <DeleteAccountDialog onClose={() => setShowDeleteDialog(false)} />
            )}
        </main>
    );
}
