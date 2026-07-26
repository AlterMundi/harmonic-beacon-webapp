"use client";

import { useEffect, useRef, useState } from "react";

interface TakeDownDialogProps {
    meditationId: string;
    /** Title of the meditation, shown so the Provider can see which one this is. */
    meditationTitle: string;
    /**
     * Whether this meditation has been published. Withdrawing a submission that
     * has never been seen by a Listener is a different act from pulling something
     * people are listening to, and the copy says which one is happening — the
     * endpoint distinguishes them too, and returns `withdrawnFromReview`.
     */
    isPublished: boolean;
    onClose: () => void;
    /** Called after a successful takedown so the list can reflect the new state. */
    onTakenDown: (result: TakeDownResponse) => void;
}

export interface TakeDownResponse {
    takenDown: true;
    withdrawnFromReview: boolean;
    meditation: {
        id: string;
        status: string;
        isPublished: boolean;
        isHidden: boolean;
    };
    /** Consequences the endpoint states. Rendered verbatim — see below. */
    retained: string[];
}

/** The user must type this exact phrase before the destructive action unlocks. */
const CONFIRM_PHRASE = "TAKE DOWN";

type Phase = "confirm" | "submitting" | "error" | "done";

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Confirmation for a Provider taking their own content down
 * (CONTENT_POLICY.md §6.1).
 *
 * The consequences in the "done" state are rendered from the endpoint's own
 * `retained` array rather than restated here. Two copies of a promise about what
 * survives a takedown is two copies to keep true, and the one the Provider reads
 * should be the one the server actually acted on.
 *
 * The pre-confirmation warning is necessarily written here, because it has to be
 * shown before the request exists. It is kept deliberately short and limited to
 * what will not change: content stops being served, the file is not deleted, and
 * putting it back is not the Provider's to do.
 */
export default function TakeDownDialog({
    meditationId,
    meditationTitle,
    isPublished,
    onClose,
    onTakenDown,
}: TakeDownDialogProps) {
    const [phase, setPhase] = useState<Phase>("confirm");
    const [confirmText, setConfirmText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<TakeDownResponse | null>(null);

    const dialogRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const canConfirm = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;
    const isBusy = phase === "submitting";

    // A withdrawal and a takedown are the same request but not the same act, and
    // the Provider should be told which one they are doing.
    const action = isPublished ? "Take Down" : "Withdraw From Review";

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

    const handleTakeDown = async () => {
        if (!canConfirm || isBusy) return;

        setPhase("submitting");
        setError(null);

        try {
            const res = await fetch(`/api/provider/meditations/${meditationId}`, {
                method: "DELETE",
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to take down this meditation");
            }

            const takedown = data as TakeDownResponse;
            setResult(takedown);
            setPhase("done");
            onTakenDown(takedown);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to take down this meditation");
            setPhase("error");
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="take-down-title"
                className="glass-card w-full max-w-lg rounded-t-2xl p-5 animate-slide-up max-h-[85vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 id="take-down-title" className="text-lg font-semibold">
                        {phase === "done"
                            ? result?.withdrawnFromReview
                                ? "Withdrawn From Review"
                                : "Taken Down"
                            : action}
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

                <p className="text-sm text-[var(--text-secondary)] mb-4 truncate">
                    <span className="text-[var(--text-muted)]">Meditation: </span>
                    <span className="font-medium text-[var(--text-primary)]">{meditationTitle}</span>
                </p>

                {phase !== "done" ? (
                    <div className="space-y-4">
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-[var(--text-secondary)] space-y-2">
                            <p className="font-medium text-red-400">
                                {isPublished
                                    ? "This stops Listeners reaching it, straight away:"
                                    : "This pulls the submission out of the review queue:"}
                            </p>
                            <ul className="list-disc list-inside space-y-1">
                                {isPublished ? (
                                    <li>It leaves the catalogue immediately and stops playing, including for anyone holding a direct link or a favourite.</li>
                                ) : (
                                    <li>It stays out of the catalogue and cannot be approved while it is down.</li>
                                )}
                                <li>The audio file is not deleted. It stops being served, but the file itself stays on our servers until an administrator removes it — ask us if you need the file destroyed.</li>
                                <li>Your listening statistics and other people&apos;s history stay intact. The record is kept, not erased.</li>
                                <li>You cannot put it back yourself. Restoring content is an administrator action.</li>
                            </ul>
                        </div>

                        <div>
                            <label
                                htmlFor="take-down-confirm-input"
                                className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5"
                            >
                                Type {CONFIRM_PHRASE} to confirm
                            </label>
                            <input
                                id="take-down-confirm-input"
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
                            <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
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
                                onClick={handleTakeDown}
                                disabled={!canConfirm || isBusy}
                                aria-label={`${action}: ${meditationTitle}`}
                                className="flex-1 rounded-xl font-semibold text-sm bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {isBusy ? "Taking down..." : action}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="p-3 rounded-lg bg-white/5 border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] space-y-2">
                            <p className="font-medium text-[var(--text-primary)]">
                                {result?.withdrawnFromReview
                                    ? "It is out of the review queue. What that leaves:"
                                    : "It is no longer being served. What that leaves:"}
                            </p>
                            <ul className="list-disc list-inside space-y-1">
                                {result?.retained.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        </div>

                        <button type="button" onClick={onClose} className="btn-primary w-full py-3">
                            <span>Done</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
