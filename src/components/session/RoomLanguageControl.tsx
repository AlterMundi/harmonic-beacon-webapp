'use client';

import { useLocale } from '@/context/LocaleContext';

/** Keep the existing in-place locale choice available without site navigation. */
export default function RoomLanguageControl() {
    const { locale, setLocale } = useLocale();
    return <button type="button" className="event-button event-button--secondary"
        aria-label={locale === 'es' ? 'Cambiar idioma a inglés' : 'Change language to Spanish'}
        onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}>
        {locale === 'es' ? 'EN' : 'ES'}
    </button>;
}
