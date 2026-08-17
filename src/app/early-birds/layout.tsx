import { headers } from 'next/headers';

import { LocaleProvider } from '@/context/LocaleContext';
import { requestBrowserLocale } from '@/lib/i18n-server';

export default async function EarlyBirdLayout({ children }: { children: React.ReactNode }) {
    const requestHeaders = await headers();
    const locale = await requestBrowserLocale(requestHeaders);

    return <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>;
}
