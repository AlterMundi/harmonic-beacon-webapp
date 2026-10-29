'use client';

import Link from 'next/link';
import ShareEventButton from '@/components/events/ShareEventButton';
import ListenerProfileSummary from './ListenerProfileSummary';
import { EventLocalTime, EventSchedule } from '@/components/events/EventSchedule';
import { useLocale } from '@/context/LocaleContext';
import { messages, type LocalizedStaffRole } from '@/lib/i18n';
import type { GlobalNavigationAccountHref } from '@/lib/brand/global-navigation';

export type ProfileView = {
    name: string | null; role: LocalizedStaffRole | null; staffActive: boolean;
    identityKey: string | null; seconds: number | null;
    events: { id: string; title: string; scheduledAt: string; status: string; publicAccess: boolean; language: string }[] | null;
};
export default function ProfileDashboard({ profile, accountHref }: { profile: ProfileView; accountHref: GlobalNavigationAccountHref }) {
    const { locale } = useLocale();
    const es = locale === 'es';
    const accountURL = new URL(accountHref);
    accountURL.searchParams.set('lang', locale);
    const staging = accountURL.hostname === 'account-staging.harmonicbeacon.com';
    const membershipURL = `https://${staging ? 'earlybirds-staging' : 'listen'}.harmonicbeacon.com/listener/membership`;
    const createHref = profile.staffActive ? '/ops/events/manage'
        : '/api/account/login?flow=staff&next=%2Fops%2Fevents%2Fmanage';
    return <main className="event-shell"><div className="hb-profile">
        <header className="hb-profile-heading">
            <div><p className="hb-profile-eyebrow">{es ? 'Tu espacio en Beacon' : 'Your Beacon space'}</p>
                <h1>{profile.name ? (es ? `Hola, ${profile.name}` : `Hello, ${profile.name}`) : (es ? 'Mi Beacon' : 'My Beacon')}</h1>
                <span className="hb-profile-role">{profile.role ? messages[locale].staffRoles[profile.role] : (es ? 'Participante' : 'Participant')}</span>
            </div>
            <div className="hb-profile-event-actions">
                <a href={accountURL.href} className="event-button event-button--secondary">{es ? 'Editar mi perfil' : 'Edit my profile'}</a>
                {profile.role && <Link href={createHref} className="event-button event-button--primary">+ {es ? 'Crear evento' : 'Create event'}</Link>}
            </div>
        </header>
        <div className="hb-profile-grid">
            <section className="hb-profile-card" aria-labelledby="profile-events-heading">
                <h2 id="profile-events-heading">{es ? 'Próximos encuentros' : 'Upcoming events'}</h2>
                {profile.events === null ? <p role="alert">{es ? 'No pudimos cargar los eventos. Volvé a intentarlo.' : 'Events are unavailable. Please try again.'}</p>
                    : profile.events.length === 0 ? <p>{es ? 'Los próximos encuentros publicados aparecerán acá.' : 'Upcoming published events will appear here.'}</p>
                    : <EventSchedule locale={locale}><ul>{profile.events.map(event => <li key={event.id} className="hb-profile-event">
                        <h3>{event.title}</h3><EventLocalTime at={event.scheduledAt} />
                        <small>{event.status === 'LIVE' ? (es ? 'En vivo' : 'Live now') : (event.language === 'SPANISH' ? 'Español' : 'English')}{' · '}{event.publicAccess ? (es ? 'Acceso libre' : 'Free access') : (es ? 'Con entrada' : 'Ticketed')}</small>
                        <div className="hb-profile-event-actions"><Link href={profile.staffActive ? `/ops/events/${event.id}` : event.publicAccess ? `/api/public-sessions/${event.id}/enter` : `/session/${event.id}`} className="event-button event-button--primary">
                            {profile.staffActive ? (es ? 'Abrir sala de equipo' : 'Open staff room') : (es ? 'Ver encuentro' : 'View event')}
                        </Link><ShareEventButton sessionId={event.id} title={event.title} /></div>
                    </li>)}</ul></EventSchedule>}
            </section>
            <aside className="hb-profile-aside">
                <section className="hb-profile-card"><h2>{es ? 'Antes del encuentro' : 'Before the meeting'}</h2><p>{es ? 'Comprobá tu micrófono, cámara y sonido.' : 'Check your microphone, camera and sound.'}</p><Link href="/devices" className="event-button event-button--secondary">{es ? 'Probar dispositivos' : 'Check devices'}</Link></section>
                <section className="hb-profile-card" aria-labelledby="profile-hours-heading">
                    <h2 id="profile-hours-heading">{es ? 'Tu tiempo compartido' : 'Your shared time'}</h2>
                    <div className="hb-profile-hours">{profile.seconds === null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(profile.seconds / 3600)} <span aria-hidden="true">h</span></div>
                    <p>{es ? 'En encuentros de Beacon Live' : 'In Beacon Live events'}</p>
                    <small>{profile.seconds === null ? (es ? 'El registro de horas no está disponible ahora.' : 'Time records are currently unavailable.') : (es ? 'Tiempo registrado en sala. Las conexiones simultáneas cuentan una sola vez.' : 'Recorded room time. Simultaneous connections count once.')}</small>
                    <a href={membershipURL}>{es ? 'Ver mi tiempo de escucha y membresía' : 'View my listening time and membership'} ↗</a>
                </section>
                <ListenerProfileSummary key={profile.identityKey ?? 'legacy'} origin={staging ? 'https://earlybirds-staging.harmonicbeacon.com' : 'https://listen.harmonicbeacon.com'} identityKey={profile.identityKey} />
            </aside>
        </div>
    </div></main>;
}
