/** Event operations use an explicit zone so SSR and hydration show the same instant. */
export const EVENT_TIME_ZONE = 'America/Argentina/Cordoba';

export function formatEventTime(value: Date | string, locale: 'es' | 'en'): string {
    return `${new Intl.DateTimeFormat(locale === 'es' ? 'es-AR' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: EVENT_TIME_ZONE,
    }).format(typeof value === 'string' ? new Date(value) : value)} ART`;
}
