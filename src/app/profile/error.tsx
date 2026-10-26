'use client';
import { useLocale } from '@/context/LocaleContext';

export default function ProfileError({ reset }: { reset: () => void }) {
    const { locale } = useLocale();
    return <main className="event-shell"><section className="hb-profile hb-profile-card">
        <h1>{locale === 'es' ? 'No pudimos abrir tu perfil' : 'Your profile is unavailable'}</h1>
        <p role="alert">{locale === 'es' ? 'Volvé a intentarlo en un momento.' : 'Please try again in a moment.'}</p>
        <button type="button" className="event-button event-button--primary" onClick={reset}>{locale === 'es' ? 'Reintentar' : 'Try again'}</button>
    </section></main>;
}
