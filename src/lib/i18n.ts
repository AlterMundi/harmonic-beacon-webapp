export const UI_LOCALE_COOKIE = 'hb_locale';
export const UI_LOCALE_STORAGE = 'hb-locale';
export const UI_LOCALE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type UiLocale = 'es' | 'en';
export type EventLanguage = 'SPANISH' | 'ENGLISH';

export function parseUiLocale(value: unknown): UiLocale | null {
    return value === 'es' || value === 'en' ? value : null;
}

export function localeForEventLanguage(language: EventLanguage | null | undefined): UiLocale {
    return language === 'ENGLISH' ? 'en' : 'es';
}

export function resolveUiLocale(
    persisted: unknown,
    eventLanguage?: EventLanguage | null,
): UiLocale {
    return parseUiLocale(persisted) ?? localeForEventLanguage(eventLanguage);
}

export type Messages = {
    language: { label: string; spanish: string; english: string };
    ticketLogin: {
        displayName: string;
        ticketCode: string;
        ticketCodeHint: string;
        email: string;
        rejected: string;
        rateLimited: string;
        unavailable: string;
        required: string;
        signingIn: string;
        enter: string;
        reconnectHint: string;
    };
    staffLogin: {
        heading: string;
        subheading: string;
        signedInAs: string;
        controls: string;
        email: string;
        emailHint: string;
        password: string;
        passwordHint: string;
        rejected: string;
        rateLimited: string;
        unavailable: string;
        required: string;
        signingIn: string;
        signIn: string;
        attendeeSignIn: string;
    };
};

export const messages: Record<UiLocale, Messages> = {
    es: {
        language: { label: 'Idioma', spanish: 'Español', english: 'Inglés' },
        ticketLogin: {
            displayName: 'Nombre visible en la sala',
            ticketCode: 'Código de entrada',
            ticketCodeHint: 'Exactamente como aparece en el correo de tu entrada',
            email: 'Correo con el que compraste la entrada',
            rejected: 'Ese código y ese correo no coinciden con una entrada activa. Revisá ambos tal como aparecen en el correo de tu entrada.',
            rateLimited: 'Hubo demasiados intentos. Esperá unos minutos y volvé a intentar.',
            unavailable: 'El ingreso no está disponible en este momento. Probá de nuevo en un momento.',
            required: 'Ingresá tu nombre, código de entrada y el correo con el que la compraste.',
            signingIn: 'Ingresando…',
            enter: 'Entrar al evento',
            reconnectHint: 'Tu entrada admite a una persona. El mismo código y correo funcionan de nuevo si recargás o se corta la conexión.',
        },
        staffLogin: {
            heading: 'Ingreso del equipo',
            subheading: 'Operación de eventos Harmonic Beacon',
            signedInAs: 'Sesión iniciada como',
            controls: 'Ir a los controles del evento',
            email: 'Correo del equipo',
            emailHint: 'La dirección entregada por la producción del evento.',
            password: 'Contraseña',
            passwordHint: 'Se entrega por un canal privado. Si se pierde, se reemplaza; no se recupera.',
            rejected: 'Esas credenciales no son válidas.',
            rateLimited: 'Hubo demasiados intentos. Esperá unos minutos y volvé a intentar.',
            unavailable: 'El ingreso no está disponible. Probá de nuevo en un momento.',
            required: 'Ingresá tu correo del equipo y tu contraseña.',
            signingIn: 'Ingresando…',
            signIn: 'Ingresar',
            attendeeSignIn: 'Ingreso de participantes',
        },
    },
    en: {
        language: { label: 'Language', spanish: 'Spanish', english: 'English' },
        ticketLogin: {
            displayName: 'Name shown in the room',
            ticketCode: 'Ticket code',
            ticketCodeHint: 'Exactly as it appears in your ticket email',
            email: 'Email used to buy the ticket',
            rejected: 'That code and email do not match an active ticket. Check both exactly as they appear in your ticket email.',
            rateLimited: 'Too many attempts. Wait a few minutes and try again.',
            unavailable: 'Sign-in is unavailable right now. Try again in a moment.',
            required: 'Enter your name, ticket code, and the email used to buy it.',
            signingIn: 'Signing in…',
            enter: 'Enter the event',
            reconnectHint: 'Your ticket admits one person. The same code and email work again after a refresh or a dropped connection.',
        },
        staffLogin: {
            heading: 'Staff sign-in',
            subheading: 'Harmonic Beacon event operations',
            signedInAs: 'Signed in as',
            controls: 'Go to event controls',
            email: 'Staff email',
            emailHint: 'The address provided by the event producer.',
            password: 'Password',
            passwordHint: 'Delivered privately. A lost password is replaced, not recovered.',
            rejected: 'Those credentials are not valid.',
            rateLimited: 'Too many attempts. Wait a few minutes and try again.',
            unavailable: 'Sign-in is unavailable right now. Try again in a moment.',
            required: 'Enter your staff email and password.',
            signingIn: 'Signing in…',
            signIn: 'Sign in',
            attendeeSignIn: 'Attendee sign-in',
        },
    },
};
