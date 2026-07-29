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

export const dynamic = "force-dynamic";

export default async function StaffLoginPage() {
    // Resolved authoritatively, unlike the cookie check in `middleware.ts`: an
    // operator whose account was disabled mid-event should see the form again,
    // not a stale "you are signed in".
    const principal = await currentPrincipal().catch(() => null);
    const signedInRole = principal?.kind === "staff" ? principal.role : null;

    return (
        <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
            <header className="space-y-1">
                <h1 className="text-2xl font-bold">Staff sign-in</h1>
                <p className="text-sm text-[var(--text-secondary)]">Harmonic Beacon event operations</p>
            </header>

            {signedInRole ? (
                <div className="space-y-3">
                    <p className="text-sm">
                        Signed in as <span className="font-medium">{signedInRole}</span>.
                    </p>
                    <Link href="/ops/admission" className="inline-block text-sm underline">
                        Go to operator controls
                    </Link>
                </div>
            ) : (
                <StaffLoginClient />
            )}

            <footer className="text-xs text-[var(--text-secondary)]">
                <Link href="/" className="underline">
                    Attendee sign-in
                </Link>
            </footer>
        </main>
    );
}
