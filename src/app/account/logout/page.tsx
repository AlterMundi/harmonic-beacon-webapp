import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import AccountLogoutClient from '@/components/account/AccountLogoutClient';
import { ACCOUNT_NAV_RETURN_TO, isAccountHost } from '@/lib/account/config';
import { requestBrowserLocale } from '@/lib/i18n-server';

export const dynamic = 'force-dynamic';

export default async function AccountLogoutPage({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const incoming = await headers();
    if (!isAccountHost(incoming.get('host'))) notFound();
    const query = await searchParams;
    const requestedLang = Array.isArray(query.lang) ? query.lang[0] : query.lang;
    const locale = requestedLang === 'es' || requestedLang === 'en'
        ? requestedLang : await requestBrowserLocale(incoming);
    const rawReturnTo = Array.isArray(query.return_to) ? query.return_to[0] : query.return_to;
    const returnTo = rawReturnTo && ACCOUNT_NAV_RETURN_TO.has(rawReturnTo)
        ? rawReturnTo : 'https://harmonicbeacon.com/';
    const rawMode = Array.isArray(query.mode) ? query.mode[0] : query.mode;
    const mode = rawMode === 'all' ? 'all' as const : 'current' as const;
    const rawInitiation = Array.isArray(query.initiation) ? query.initiation[0] : query.initiation;
    const initiation = typeof rawInitiation === 'string' && rawInitiation.length <= 2048
        ? rawInitiation : null;
    return <main className="account-shell"><AccountLogoutClient
        mode={mode} returnTo={returnTo} locale={locale} initiation={initiation}
    /></main>;
}
