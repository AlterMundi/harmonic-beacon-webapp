import Link from "next/link";

import { messages } from "@/lib/i18n";
import { requestLocale } from "@/lib/i18n-server";

import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

const INTERNAL_NEXT = /^\/session(\/[A-Za-z0-9_-]+)*$/;

function safeNext(raw: string | string[] | undefined): string | undefined {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && INTERNAL_NEXT.test(value) ? value : undefined;
}

/** Stable ticket-entry surface when the public landing contains only free events. */
export default async function AttendeeLoginPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const locale = await requestLocale();
    const copy = messages[locale];
    const next = safeNext((await searchParams).next);

    return (
        <main className="event-shell">
            <div className="relative z-10 mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
                <header className="space-y-2">
                    <p className="hb-section-label">Harmonic Beacon · Live</p>
                    <h1 className="font-serif text-3xl font-normal text-[var(--paper)]">
                        {copy.landing.loginHeading}
                    </h1>
                </header>

                <div className="event-card">
                    <LoginClient next={next} />
                </div>

                <footer className="text-xs text-[var(--text-muted)]">
                    <Link href="/" className="underline underline-offset-2 transition-colors hover:text-[var(--paper)]">
                        {copy.session.backToSessions}
                    </Link>
                </footer>
            </div>
        </main>
    );
}
