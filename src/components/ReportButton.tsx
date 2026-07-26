"use client";

import { useEffect, useRef, useState } from "react";
import { redactErrorDetail } from "@/lib/redact";

/** Mirrors the enum POST /api/reports accepts. */
export type ReportTargetType = "MEDITATION" | "SESSION" | "USER";

interface ReportButtonProps {
    targetType: ReportTargetType;
    targetId: string;
    /** Human name of the thing being reported — becomes part of the trigger's accessible name. */
    targetLabel: string;
    /** "icon" is a bare flag for dense lists; "text" is a labelled button. */
    variant?: "icon" | "text";
    className?: string;
}

interface ReportDialogProps extends Omit<ReportButtonProps, "variant" | "className"> {
    onClose: () => void;
}

/** Reasons the endpoint accepts, with the wording a Listener would recognise. */
const REASONS: { value: string; label: string; hint: string }[] = [
    { value: "SAFETY", label: "Safety", hint: "Harm, crisis content, or something that put someone at risk" },
    { value: "THERAPEUTIC_CLAIM", label: "Medical or therapeutic claim", hint: "Presented as treatment, diagnosis or a cure" },
    { value: "COPYRIGHT", label: "Copyright", hint: "Published without the right to publish it" },
    { value: "SPAM", label: "Spam", hint: "Advertising, repetition, or content that is not what it claims" },
    { value: "OTHER", label: "Something else", hint: "Describe it below" },
];

/** Matches the cap POST /api/reports enforces, so the limit is visible before submitting. */
const MAX_DETAIL_LENGTH = 4000;

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

const TARGET_NOUNS: Record<ReportTargetType, string> = {
    MEDITATION: "meditation",
    SESSION: "session",
    USER: "person",
};

type Phase = "form" | "submitting" | "sent" | "duplicate";

/**
 * The report dialog itself. Split out from the trigger so a surface that already
 * owns an overflow menu can open it directly.
 */
export function ReportDialog({ targetType, targetId, targetLabel, onClose }: ReportDialogProps) {
    const [phase, setPhase] = useState<Phase>("form");
    const [reason, setReason] = useState<string>("");
    const [detail, setDetail] = useState("");
    const [error, setError] = useState<string | null>(null);

    const dialogRef = useRef<HTMLDivElement>(null);
    const firstFieldRef = useRef<HTMLInputElement>(null);

    const isBusy = phase === "submitting";
    const noun = TARGET_NOUNS[targetType];

    // Autofocus the first reason, and trap focus + Escape-to-close while open.
    useEffect(() => {
        firstFieldRef.current?.focus();

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

    const handleSubmit = async () => {
        if (!reason || isBusy) return;

        setPhase("submitting");
        setError(null);

        try {
            const res = await fetch("/api/reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    targetType,
                    targetId,
                    reason,
                    ...(detail.trim() ? { detail: detail.trim() } : {}),
                }),
            });

            // 409 is not a failure. The reporter did the right thing twice; the
            // queue simply already has their report. Telling them so is the
            // settled answer, and an error banner would read as a rebuke.
            if (res.status === 409) {
                setPhase("duplicate");
                return;
            }

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || "Could not send this report");
            }

            setPhase("sent");
        } catch (e) {
            console.error("Failed to file report:", redactErrorDetail(e));
            setError(e instanceof Error ? e.message : "Could not send this report");
            setPhase("form");
        }
    };

    const title = phase === "sent"
        ? "Report received"
        : phase === "duplicate"
            ? "Already reported"
            : `Report this ${noun}`;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="report-dialog-title"
                className="glass-card w-full max-w-lg rounded-t-2xl p-5 animate-slide-up max-h-[85vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 id="report-dialog-title" className="text-lg font-semibold">
                        {title}
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

                {phase === "form" || phase === "submitting" ? (
                    <div className="space-y-4">
                        <p className="text-sm text-[var(--text-secondary)]">
                            You are reporting <span className="text-[var(--text-primary)] font-medium">{targetLabel}</span>.
                        </p>

                        <fieldset disabled={isBusy}>
                            <legend className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                                What is wrong with it?
                            </legend>
                            <div className="space-y-2">
                                {REASONS.map((r, i) => (
                                    <label
                                        key={r.value}
                                        htmlFor={`report-reason-${r.value}`}
                                        className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${reason === r.value
                                            ? "bg-[var(--primary-600)]/20 border-[var(--primary-500)]"
                                            : "bg-white/5 border-[var(--border-subtle)] hover:bg-white/10"
                                            }`}
                                    >
                                        <input
                                            id={`report-reason-${r.value}`}
                                            ref={i === 0 ? firstFieldRef : undefined}
                                            type="radio"
                                            name="report-reason"
                                            value={r.value}
                                            checked={reason === r.value}
                                            onChange={() => setReason(r.value)}
                                            className="mt-0.5 accent-[var(--primary-500)]"
                                        />
                                        <span className="min-w-0">
                                            <span className="block text-sm font-medium">{r.label}</span>
                                            <span className="block text-xs text-[var(--text-muted)] mt-0.5">{r.hint}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>

                        <div>
                            <label
                                htmlFor="report-detail"
                                className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5"
                            >
                                Anything else we should know? (optional)
                            </label>
                            <textarea
                                id="report-detail"
                                value={detail}
                                onChange={(e) => setDetail(e.target.value.slice(0, MAX_DETAIL_LENGTH))}
                                disabled={isBusy}
                                rows={4}
                                maxLength={MAX_DETAIL_LENGTH}
                                placeholder="What happened, and where in the recording?"
                                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-[var(--border-subtle)] text-sm focus:outline-none focus:border-[var(--primary-500)] transition-colors disabled:opacity-50"
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
                                onClick={handleSubmit}
                                disabled={!reason || isBusy}
                                className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <span>{isBusy ? "Sending..." : "Send report"}</span>
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {phase === "duplicate" ? (
                            // Deliberately not styled as an error. Nothing went wrong.
                            <div className="p-3 rounded-lg bg-white/5 border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] space-y-2">
                                <p>You have already reported this, and that report is still open.</p>
                                <p>
                                    Sending it again would not move it along, so we have not filed a second
                                    one. Nothing more is needed from you.
                                </p>
                            </div>
                        ) : (
                            <div className="p-3 rounded-lg bg-white/5 border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] space-y-2">
                                <p>Your report is in the moderation queue.</p>
                                <p>
                                    A person reads every report — nothing here is decided automatically. The
                                    app will not write back to you about it, so you do not need to keep this
                                    open or report it again.
                                </p>
                            </div>
                        )}

                        <button type="button" onClick={onClose} className="btn-primary w-full py-3">
                            <span>Done</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * The report affordance. BUSINESS_RULES.md §10 / TRUST_AND_SAFETY.md §2.5: the
 * capture path existed before this did, which meant only someone calling the API
 * directly could report anything.
 */
export default function ReportButton({
    targetType,
    targetId,
    targetLabel,
    variant = "text",
    className = "",
}: ReportButtonProps) {
    const [open, setOpen] = useState(false);

    // There can be several of these on one page, so the name has to say which
    // one it is, not just "Report".
    const accessibleName = `Report ${TARGET_NOUNS[targetType]}: ${targetLabel}`;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={accessibleName}
                className={
                    variant === "icon"
                        // Size comes from the caller so the control can sit in a row of
                        // 14-unit transport buttons without fighting the default.
                        ? `rounded-full bg-white/10 text-[var(--text-muted)] hover:bg-white/20 hover:text-[var(--text-secondary)] transition-colors flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-400)] ${className || "w-8 h-8"}`
                        : `inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-400)] ${className}`
                }
            >
                <svg className={variant === "icon" ? "w-6 h-6" : "w-4 h-4"} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 2H21l-3 6 3 6h-8.5l-1-2H5a2 2 0 00-2 2z" />
                </svg>
                {variant === "text" && <span aria-hidden="true">Report</span>}
            </button>

            {open && (
                <ReportDialog
                    targetType={targetType}
                    targetId={targetId}
                    targetLabel={targetLabel}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}
