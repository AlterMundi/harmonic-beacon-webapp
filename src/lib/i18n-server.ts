import { cookies } from 'next/headers';

import {
    localeForBrowserLanguage,
    parseUiLocale,
    UI_LOCALE_COOKIE,
    resolveUiLocale,
    type EventLanguage,
    type UiLocale,
} from '@/lib/i18n';

export async function requestLocale(eventLanguage?: EventLanguage | null): Promise<UiLocale> {
    const cookieStore = await cookies();
    return resolveUiLocale(cookieStore.get(UI_LOCALE_COOKIE)?.value, eventLanguage);
}

export async function requestBrowserLocale(
    headers: Pick<Headers, 'get'>,
): Promise<UiLocale> {
    const cookieStore = await cookies();
    return parseUiLocale(cookieStore.get(UI_LOCALE_COOKIE)?.value)
        ?? localeForBrowserLanguage(headers.get('accept-language'));
}
