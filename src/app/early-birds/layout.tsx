import { headers } from 'next/headers';

import { LocaleProvider } from '@/context/LocaleContext';
import { localeForBrowserLanguage } from '@/lib/i18n';

export default async function EarlyBirdLayout({ children }: { children: React.ReactNode }) {
    const requestHeaders = await headers();
    const locale = localeForBrowserLanguage(requestHeaders.get('accept-language'));

    return <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>;
}
