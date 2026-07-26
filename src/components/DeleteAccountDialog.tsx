"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";

interface DeleteAccountDialogProps {
    onClose: () => void;
}

interface DeleteAccountResponse {
    deleted: true;
    deletedData: string[];
    retained: string[];
    authoredContentCount: number;
}

/** The user must type this exact phrase before the destructive action unlocks. */
const CONFIRM_PHRASE = "DELETE";

type Phase = "confirm" | "deleting" | "error" | "done";

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function DeleteAccountDialog({ onClose }: DeleteAccountDialogProps) {
    const [phase, setPhase] = useState<Phase>("confirm");
    const [confirmText, setConfirmText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<DeleteAccountResponse | null>(null);

    const dialogRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const canConfirm = confirmText === CONFIRM_PHRASE;
    const isBusy = phase === "deleting";

    // Autofocus the confirmation input, and trap focus + Escape-to-close while open.
    useEffect(() => {
        inputRef.current?.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (!isBusy) onClose();
                return;
            }

            if (e.key !== "Tab" || !dialogRef.current) return;

            const focusable = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
            );
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBusy]);

    const handleDelete = async () => {
        if (!canConfirm || isBusy) return;

        setPhase("deleting");
        setError(null);

        try {
            const res = await fetch("/api/users/me", { method: "DELETE" });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to delete account");
            }

            setResult(data as DeleteAccountResponse);
            setPhase("done");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete account");
            setPhase("error");
        }
    };

    const handleFinish = async () => {
        await signOut({ callbackUrl: "/login" });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-account-title"
                className="glass-card w-full max-w-lg rounded-t-2xl p-5 animate-slide-up max-h-[85vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 id="delete-account-title" className="text-lg font-semibold">
                        {phase === "done" ? "Account Deleted" : "Delete Account"}
                    </h3>
                    <button
                        onClick={onClose}
                        disabled={isBusy}
                        aria-label="Close dialog"
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center disabled:opacity-50"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {phase !== "done" ? (
                    <div className="space-y-4">
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-[var(--text-secondary)] space-y-2">
                            <p className="font-medium text-red-400">This is permanent for your personal data, but not for everything tied to your account:</p>
                            <ul className="list-disc list-inside space-y-1">
                                <li>Your profile identifiers (email, name, avatar, sign-in link), favourites, listening history and session participation records are removed.</li>
                                <li>Your account row is kept in an anonymised form, because other listeners&apos; session history references it. It will no longer hold anything that identifies you.</li>
                                <li>Stored audio is not purged by this action.</li>
                                <li>If you have published meditations or hosted sessions, they remain published under an anonymised provider record until a provider takedown path exists.</li>
                            </ul>
                        </div>

                        <div>
                            <label
                                htmlFor="delete-confirm-input"
                                className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5"
                            >
                                Type {CONFIRM_PHRASE} to confirm
                            </label>
                            <input
                                id="delete-confirm-input"
                                ref={inputRef}
                                type="text"
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                disabled={isBusy}
                                autoComplete="off"
                                placeholder={CONFIRM_PHRASE}
                                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-[var(--border-subtle)] text-sm focus:outline-none focus:border-red-500 transition-colors disabled:opacity-50"
                            />
                        </div>

                        {error && (
                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                                {error}
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isBusy}
                                className="btn-secondary flex-1 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={!canConfirm || isBusy}
                                aria-label="Permanently delete my account"
                                className="flex-1 rounded-xl font-semibold text-sm bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {isBusy ? "Deleting..." : "Delete Account"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="p-3 rounded-lg bg-white/5 border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] space-y-2">
                            <p className="font-medium text-[var(--text-primary)]">Removed:</p>
                            <ul className="list-disc list-inside space-y-1">
                                {result?.deletedData.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                            <p className="font-medium text-[var(--text-primary)] pt-2">Retained:</p>
                            <ul className="list-disc list-inside space-y-1">
                                {result?.retained.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        </div>

                        {result && result.authoredContentCount > 0 && (
                            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400">
                                You authored {result.authoredContentCount} item
                                {result.authoredContentCount === 1 ? "" : "s"} (meditations or hosted sessions).
                                These remain published under an anonymised provider record — contact an
                                administrator if you need them taken down.
                            </div>
                        )}

                        <button type="button" onClick={handleFinish} className="btn-primary w-full py-3">
                            <span>Sign Out</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
