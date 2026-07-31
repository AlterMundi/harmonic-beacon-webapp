'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';

import {
    messages,
    parseUiLocale,
    UI_LOCALE_COOKIE,
    UI_LOCALE_MAX_AGE_SECONDS,
    UI_LOCALE_STORAGE,
    type Messages,
    type UiLocale,
} from '@/lib/i18n';

type LocaleValue = {
    locale: UiLocale;
    copy: Messages;
    setLocale: (locale: UiLocale) => void;
};

const LocaleContext = createContext<LocaleValue | null>(null);

function applyDocumentLocale(locale: UiLocale): void {
    document.documentElement.lang = locale;
    document.documentElement.dataset.lang = locale;
}

function persistLocale(locale: UiLocale): void {
    try {
        window.localStorage.setItem(UI_LOCALE_STORAGE, locale);
    } catch {
        // Storage can be unavailable in hardened/private browser contexts.
    }
    document.cookie = `${UI_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${UI_LOCALE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function LocaleProvider({
    initialLocale,
    children,
}: {
    initialLocale: UiLocale;
    children: React.ReactNode;
}) {
    const [locale, setLocaleState] = useState<UiLocale>(initialLocale);

    useEffect(() => {
        applyDocumentLocale(locale);
        persistLocale(locale);
    }, [locale]);

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== UI_LOCALE_STORAGE) return;
            const next = parseUiLocale(event.newValue);
            if (!next) return;
            setLocaleState(next);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const setLocale = useCallback((next: UiLocale) => {
        setLocaleState(next);
    }, []);

    const value = useMemo<LocaleValue>(
        () => ({ locale, copy: messages[locale], setLocale }),
        [locale, setLocale],
    );

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
    const value = useContext(LocaleContext);
    if (!value) {
        throw new Error('useLocale must be used inside LocaleProvider');
    }
    return value;
}
