import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { ResetPasswordClient } from '@/components/account/ResetPasswordClient';
import { isAccountHost } from '@/lib/account/config';
import { requestBrowserLocale } from '@/lib/i18n-server';

export default async function ResetPasswordPage() {
    const incoming = await headers();
    if (!isAccountHost(incoming.get('host'))) notFound();
    const locale = await requestBrowserLocale(incoming);
    return <main className="account-shell account-shell--center"><ResetPasswordClient locale={locale} /></main>;
}
