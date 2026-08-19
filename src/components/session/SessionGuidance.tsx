"use client";

import { useId, useState } from "react";
import type { Messages } from "@/lib/i18n";

type SessionGuidanceCopy = Messages["session"]["guidance"];

interface SessionGuidanceProps {
    copy: SessionGuidanceCopy;
    className?: string;
}

/**
 * Brief, bilingual-by-locale listener guidance: why the room invites a
 * question, what the master volume and Beacon/Session balance do, and the
 * independence of camera and microphone. Purely presentational — it owns no
 * media, network, or room state, so opening or closing it can never remount
 * the Room, touch an AudioContext, or call a device handler. The disclosure
 * starts closed and stays quiet next to the scene; the native <button>
 * carries keyboard support and focus retention, and the `hidden` panel adds
 * no animation (prefers-reduced-motion safe by construction).
 */
export default function SessionGuidance({ copy, className }: SessionGuidanceProps) {
    const [expanded, setExpanded] = useState(false);
    const panelId = useId();

    return (
        <div className={className} data-testid="session-guidance">
            <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setExpanded((value) => !value)}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-alt)]/60 px-4 py-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/40 hover:text-[var(--cream)] motion-reduce:transition-none"
            >
                <svg
                    className={`h-3.5 w-3.5 shrink-0 text-[var(--gold)] motion-safe:transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                <span>{copy.label}</span>
            </button>
            <div
                id={panelId}
                hidden={!expanded}
                className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-alt)]/80 px-4 py-4 text-left"
            >
                <p className="text-sm leading-6 text-[var(--cream)]">{copy.intention}</p>
                <ul className="mt-3 list-none space-y-2 text-xs leading-5 text-[var(--text-secondary)]">
                    <li>{copy.volume}</li>
                    <li>{copy.balance}</li>
                    <li>{copy.balanceFullBeacon}</li>
                    <li>{copy.cameraMic}</li>
                    <li>{copy.control}</li>
                </ul>
            </div>
        </div>
    );
}
