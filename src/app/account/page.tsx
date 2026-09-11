import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import AccountClient from '@/components/account/AccountClient';
import { requiredProviderFromSignedQuery } from '@/lib/account/required-provider';
import { currentAccountSession } from '@/lib/account/auth';
import { ACCOUNT_NAV_RETURN_TO, accountSocialProviderConfiguration, isAccountHost } from '@/lib/account/config';
import { requestBrowserLocale } from '@/lib/i18n-server';

export const dynamic = 'force-dynamic';

export default async function AccountPage({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const incoming = await headers();
    if (!isAccountHost(incoming.get('host'))) notFound();
    const query = await searchParams;
    const requestedLang = Array.isArray(query.lang) ? query.lang[0] : query.lang;
    const locale = requestedLang === 'es' || requestedLang === 'en'
        ? requestedLang : await requestBrowserLocale(incoming);
    const rawReturnTo = Array.isArray(query.return_to) ? query.return_to[0] : query.return_to;
    const returnTo = rawReturnTo && ACCOUNT_NAV_RETURN_TO.has(rawReturnTo) ? rawReturnTo : null;
    const requiredProvider = requiredProviderFromSignedQuery(query);
    const session = await currentAccountSession(new Headers(incoming));
    const providers = accountSocialProviderConfiguration();
    return (
        <main className="account-shell">
            <header className="account-hero">
                <a href="https://harmonicbeacon.com" className="account-brand">Harmonic Beacon</a>
                <p className="account-eyebrow">{locale === 'es' ? 'Cuenta' : 'Account'}</p>
                <h1>{locale === 'es' ? 'Tu identidad Beacon' : 'Your Beacon identity'}</h1>
            </header>
            <AccountClient
                initialSession={session ? {
                    user: session.user,
                    profile: session.profile,
                } : null}
                providers={{ google: Boolean(providers.google), apple: Boolean(providers.apple) }}
                locale={locale}
                returnTo={returnTo}
                requiredProvider={requiredProvider}
            />
        </main>
    );
}
