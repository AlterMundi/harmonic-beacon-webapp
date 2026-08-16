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
import LanguageControl from "@/components/brand/LanguageControl";
import { messages } from "@/lib/i18n";
import { requestLocale } from "@/lib/i18n-server";
import { staffRoleLabel } from "@/lib/i18n";
import { resolveStaffLanding } from "@/lib/staff-navigation";

export const dynamic = "force-dynamic";

export default async function StaffLoginPage() {
    const locale = await requestLocale();
    const copy = messages[locale].staffLogin;
    const principal = await currentPrincipal().catch(() => null);
    const signedInRole = principal?.kind === "staff" ? principal.role : null;
    const signedInLanding = principal?.kind === "staff"
        ? await resolveStaffLanding({ id: principal.userId, role: principal.role })
            .catch(() => "/ops/events")
        : null;

    return (
        <main className="event-shell">
            <div className="relative z-10 mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
                <header className="space-y-1">
                    <div className="event-auth-header flex items-center justify-between gap-4">
                        <BrandLockup href="/" />
                        <LanguageControl />
                    </div>
                    <h1 className="pt-4 font-serif text-2xl font-normal text-[var(--paper)]">
                        {copy.heading}
                    </h1>
                    <p className="text-sm text-[var(--text-muted)]">
                        {copy.subheading}
                    </p>
                </header>

                {signedInRole ? (
                    <div className="space-y-4">
                        <div className="event-alert event-alert--info">
                            {copy.signedInAs}{' '}
                            <span className="font-medium text-[var(--paper)]">
                                {staffRoleLabel(messages[locale], signedInRole)}
                            </span>.
                        </div>
                        <Link
                            href={signedInLanding ?? "/ops/events"}
                            className="event-button event-button--primary inline-flex w-full"
                        >
                            {copy.controls}
                        </Link>
                    </div>
                ) : (
                    <StaffLoginClient />
                )}

                <footer className="text-xs text-[var(--text-muted)]">
                    <Link href="/" className="underline underline-offset-2 transition-colors hover:text-[var(--paper)]">
                        {copy.attendeeSignIn}
                    </Link>
                </footer>
            </div>
        </main>
    );
}
