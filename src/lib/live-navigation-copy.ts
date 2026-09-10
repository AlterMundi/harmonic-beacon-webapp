import type { UiLocale } from './i18n';

type LiveNavigationCopy = {
    primary: string; userMenu: string; signedInMenu: string; account: string;
    events: string; listen: string; news: string; operations: string;
    signOut: string; signingOut: string; signOutError: string;
    eventOperations: string; analytics: string;
};
export const liveNavigationCopy: Record<UiLocale, LiveNavigationCopy> = {
    es: {
        primary: 'Navegación principal', userMenu: 'Menú de usuario',
        signedInMenu: 'Menú de usuario, sesión iniciada', account: 'Cuenta',
        events: 'Eventos', listen: 'Escuchar', news: 'Novedades', operations: 'Operaciones',
        signOut: 'Cerrar sesión', signingOut: 'Cerrando…',
        signOutError: 'No pudimos cerrar la sesión. Intentá de nuevo.',
        eventOperations: 'Operaciones de eventos', analytics: 'Analítica',
    },
    en: {
        primary: 'Primary navigation', userMenu: 'User menu',
        signedInMenu: 'User menu, signed in', account: 'Account',
        events: 'Events', listen: 'Listen', news: 'News', operations: 'Operations',
        signOut: 'Sign out', signingOut: 'Signing out…',
        signOutError: 'We could not sign you out. Please try again.',
        eventOperations: 'Event operations', analytics: 'Analytics',
    },
};
