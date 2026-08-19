'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type ScheduleLocale = 'es' | 'en';

type TimeZoneOption = {
    value: string;
    es: string;
    en: string;
};

export const EVENT_TIME_ZONES: TimeZoneOption[] = [
    { value: 'America/Argentina/Buenos_Aires', es: 'Argentina', en: 'Argentina' },
    { value: 'America/La_Paz', es: 'Bolivia', en: 'Bolivia' },
    { value: 'America/Sao_Paulo', es: 'Brasil (São Paulo)', en: 'Brazil (São Paulo)' },
    { value: 'America/Santiago', es: 'Chile (Santiago)', en: 'Chile (Santiago)' },
    { value: 'America/Bogota', es: 'Colombia', en: 'Colombia' },
    { value: 'America/Costa_Rica', es: 'Costa Rica', en: 'Costa Rica' },
    { value: 'America/Havana', es: 'Cuba', en: 'Cuba' },
    { value: 'America/Guayaquil', es: 'Ecuador', en: 'Ecuador' },
    { value: 'America/El_Salvador', es: 'El Salvador', en: 'El Salvador' },
    { value: 'Europe/Madrid', es: 'España peninsular', en: 'Mainland Spain' },
    { value: 'Atlantic/Canary', es: 'España (Canarias)', en: 'Spain (Canary Islands)' },
    { value: 'America/New_York', es: 'Estados Unidos (Este)', en: 'United States (Eastern)' },
    { value: 'America/Chicago', es: 'Estados Unidos (Centro)', en: 'United States (Central)' },
    { value: 'America/Denver', es: 'Estados Unidos (Montaña)', en: 'United States (Mountain)' },
    { value: 'America/Los_Angeles', es: 'Estados Unidos (Pacífico)', en: 'United States (Pacific)' },
    { value: 'America/Guatemala', es: 'Guatemala', en: 'Guatemala' },
    { value: 'America/Tegucigalpa', es: 'Honduras', en: 'Honduras' },
    { value: 'America/Mexico_City', es: 'México (Ciudad de México)', en: 'Mexico (Mexico City)' },
    { value: 'America/Managua', es: 'Nicaragua', en: 'Nicaragua' },
    { value: 'America/Panama', es: 'Panamá', en: 'Panama' },
    { value: 'America/Asuncion', es: 'Paraguay', en: 'Paraguay' },
    { value: 'America/Lima', es: 'Perú', en: 'Peru' },
    { value: 'America/Puerto_Rico', es: 'Puerto Rico', en: 'Puerto Rico' },
    { value: 'America/Santo_Domingo', es: 'República Dominicana', en: 'Dominican Republic' },
    { value: 'America/Montevideo', es: 'Uruguay', en: 'Uruguay' },
    { value: 'America/Caracas', es: 'Venezuela', en: 'Venezuela' },
    { value: 'UTC', es: 'UTC', en: 'UTC' },
];

const DEFAULT_TIME_ZONE = EVENT_TIME_ZONES[0];

type EventTimeContextValue = {
    locale: ScheduleLocale;
    option: TimeZoneOption;
};

const EventTimeContext = createContext<EventTimeContextValue>({
    locale: 'es',
    option: DEFAULT_TIME_ZONE,
});

export function EventSchedule({ children, locale }: { children: ReactNode; locale: ScheduleLocale }) {
    const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE.value);
    const option = useMemo(
        () => EVENT_TIME_ZONES.find((candidate) => candidate.value === timeZone) ?? DEFAULT_TIME_ZONE,
        [timeZone],
    );

    return (
        <EventTimeContext.Provider value={{ locale, option }}>
            <div className="event-time-zone">
                <label htmlFor="event-time-zone" className="event-time-zone__label">
                    {locale === 'en' ? 'Show times for' : 'Ver horarios para'}
                </label>
                <div className="event-time-zone__control">
                    <select
                        id="event-time-zone"
                        className="event-time-zone__select"
                        value={timeZone}
                        onChange={(event) => setTimeZone(event.target.value)}
                    >
                        {EVENT_TIME_ZONES.map((candidate) => (
                            <option key={candidate.value} value={candidate.value}>
                                {candidate[locale]}
                            </option>
                        ))}
                    </select>
                    <span aria-hidden="true" className="event-time-zone__chevron">⌄</span>
                </div>
            </div>
            {children}
        </EventTimeContext.Provider>
    );
}

function formatDateTime(at: Date, locale: ScheduleLocale, timeZone: string): string {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-AR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone,
        timeZoneName: 'short',
    }).format(at);
}

function formatTime(at: Date, locale: ScheduleLocale, timeZone: string): string {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone,
    }).format(at);
}

export function EventLocalTime({ at }: { at: string }) {
    const { locale, option } = useContext(EventTimeContext);
    const date = new Date(at);
    const label = option[locale];

    return (
        <>
            <div className="event-local-time">
                <p className="event-local-time__primary" aria-live="polite">
                    <span className="font-medium text-[var(--paper)]">{label}: </span>
                    {formatDateTime(date, locale, option.value)}
                </p>
                <p className="event-local-time__utc">
                    {locale === 'en' ? 'Universal reference' : 'Referencia universal'}:{' '}
                    {formatTime(date, locale, 'UTC')} UTC
                </p>
            </div>
            <p className="event-local-time__clock" aria-hidden="true">
                {formatTime(date, locale, option.value)}
            </p>
        </>
    );
}
