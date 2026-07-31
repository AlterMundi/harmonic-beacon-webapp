/**
 * Staff sign-in: Julián, two operators, one admin.
 *
 * Four seeded credentials and no other way in — no signup, no reset link, no
 * "forgot password", no listener account. Credentials are delivered out of band
 * by whoever holds the production secrets (WS6-03); a lost one is re-seeded, not
 * recovered.
 */

import Link from "next/link";

import { currentPrincipal } from "@/lib/auth";

import StaffLoginClient from "./StaffLoginClient";
import BrandLockup from "@/components/brand/BrandLockup";

export const dynamic = "force-dynamic";

export default async function StaffLoginPage() {
    const principal = await currentPrincipal().catch(() => null);
    const signedInRole = principal?.kind === "staff" ? principal.role : null;

    return (
        <main className="event-shell">
            <div className="relative z-10 mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
                <header className="space-y-1">
                    <BrandLockup href="/" />
                    <h1 className="pt-4 font-serif text-2xl font-normal text-[var(--paper)]">
                        Staff sign-in
                    </h1>
                    <p className="text-sm text-[var(--text-muted)]">
                        Harmonic Beacon event operations
                    </p>
                </header>

                {signedInRole ? (
                    <div className="space-y-4">
                        <div className="event-alert event-alert--info">
                            Signed in as <span className="font-medium text-[var(--paper)]">{signedInRole}</span>.
                        </div>
                        <Link
                            href="/ops/health"
                            className="event-button event-button--primary inline-flex w-full"
                        >
                            Go to operator controls
                        </Link>
                    </div>
                ) : (
                    <StaffLoginClient />
                )}

                <footer className="text-xs text-[var(--text-muted)]">
                    <Link href="/" className="underline underline-offset-2 transition-colors hover:text-[var(--paper)]">
                        Attendee sign-in / Ingreso de participantes
                    </Link>
                </footer>
            </div>
        </main>
    );
}
