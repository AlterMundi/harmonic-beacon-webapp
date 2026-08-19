import Link from 'next/link';

import { beaconAccountEnabled } from '@/lib/account-rp';
import { messages } from '@/lib/i18n';
import { requestLocale } from '@/lib/i18n-server';
import { currentAccountIdentity } from '@/lib/principal';

import LoginClient from './LoginClient';

export const dynamic = 'force-dynamic';

const INTERNAL_NEXT = /^\/session(\/[A-Za-z0-9_-]+)*$/;

function safeNext(raw: string | string[] | undefined): string | undefined {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && INTERNAL_NEXT.test(value) ? value : undefined;
}

/** Stable ticket entry when the public landing contains only free events. */
export default async function AttendeeLoginPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const locale = await requestLocale();
    const copy = messages[locale];
    const params = await searchParams;
    const next = safeNext(params.next);
    const accountEnabled = beaconAccountEnabled();
    const account = accountEnabled
        ? await currentAccountIdentity().catch(() => null)
        : null;

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
                    {accountEnabled && !account ? (
                        <div className="space-y-4">
                            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                                {copy.ticketLogin.accountRequired}
                            </p>
                            {params.account_error === '1' && (
                                <div role="alert" className="event-alert event-alert--danger">
                                    {copy.ticketLogin.accountError}
                                </div>
                            )}
                            <a
                                className="event-button event-button--primary inline-flex w-full"
                                href={`/api/account/login?flow=attendee${next ? `&next=${encodeURIComponent(next)}` : ''}`}
                            >
                                {copy.ticketLogin.accountContinue}
                            </a>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {accountEnabled && (
                                <p className="text-xs text-[var(--text-muted)]">
                                    {copy.ticketLogin.accountConnected}
                                </p>
                            )}
                            <LoginClient
                                next={next}
                                {...(accountEnabled ? {
                                    accountEnabled: true,
                                    defaultDisplayName: account?.displayName ?? '',
                                } : {})}
                            />
                        </div>
                    )}
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
