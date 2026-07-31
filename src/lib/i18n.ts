export const UI_LOCALE_COOKIE = 'hb_locale';
export const UI_LOCALE_STORAGE = 'hb-locale';
export const UI_LOCALE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type UiLocale = 'es' | 'en';
export type EventLanguage = 'SPANISH' | 'ENGLISH';

export const STAFF_ROLE_KEYS = [
    'FACILITATOR',
    'FACILITATOR_OP',
    'OPERATOR',
    'ADMIN',
] as const;
export type LocalizedStaffRole = (typeof STAFF_ROLE_KEYS)[number];

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
    landing: {
        eyebrow: string;
        heroLead: string;
        heroAccent: string;
        lead: string;
        portalLabel: string;
        portalSub: string;
        sessionsHeading: string;
        loginHeading: string;
        terms: string;
        staff: string;
        costaRica: string;
        argentina: string;
        buyTicket: string;
        salesSoon: string;
        unavailable: string;
        noSessions: string;
        english: string;
        spanish: string;
        globalNorth: string;
        globalSouth: string;
    };
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
    session: {
        participantFallback: string;
        connection: Record<'connected' | 'connecting' | 'reconnecting' | 'disconnected', string>;
        connectingHeading: string;
        connectingBody: string;
        connectionErrorHeading: string;
        tryAgain: string;
        backToSessions: string;
        endedHeading: string;
        endedBody: string;
        connectionLostHeading: string;
        connectionLostBody: string;
        disconnectedHeading: string;
        disconnectedBody: string;
        rejoin: string;
        sessionFallback: string;
        participantSingular: string;
        participantPlural: string;
        signedIn: string;
        staffConsole: string;
        audioActivationLabel: string;
        audioPrompt: string;
        startAudio: string;
        beaconAudioError: string;
        audioError: string;
        yourTurn: string;
        invitationHeading: string;
        invitationBody: string;
        acceptInvitation: string;
        declineInvitation: string;
        acceptingInvitation: string;
        decliningInvitation: string;
        invitationDeviceError: string;
        invitationDeclineError: string;
        masterVolume: string;
        mix: string;
        sessionChannel: string;
        beaconRoom: string;
        playlist: string;
        live: string;
        active: string;
        none: string;
        error: string;
        mic: string;
        muteMicrophone: string;
        unmuteMicrophone: string;
        camera: string;
        turnCameraOff: string;
        turnCameraOn: string;
        audioOnly: string;
        turnVideoOn: string;
        switchToAudioOnly: string;
        leave: string;
        leaveSession: string;
        preparingRoom: string;
        confirmingEntry: string;
        entryUnavailable: string;
        ticketConfirmed: string;
        doorsClosed: string;
        doorsReconnecting: string;
        doorsChecking: string;
        cancelledHeading: string;
        cancelledBody: string;
        closingBody: string;
    };
    hand: {
        staffCollision: string;
        unauthorized: string;
        raiseFailed: string;
        lowerFailed: string;
        statusUnavailable: string;
        raise: string;
        lower: string;
        onStage: string;
        queuedPrefix: string;
        queuedSuffix: string;
    };
    stage: {
        label: string;
        audioOnly: string;
        waiting: string;
        you: string;
        connecting: string;
        cameraOff: string;
        microphoneMuted: string;
        quality: Record<'excellent' | 'good' | 'poor' | 'lost' | 'unknown', string>;
    };
    tapestry: {
        label: string;
        latestAlt: string;
        waiting: string;
        stopCamera: string;
        shareSnapshot: string;
        permissionDenied: string;
    };
    staffRoles: Record<LocalizedStaffRole, string>;
    ops: {
        brand: string;
        events: string;
        health: string;
        admission: string;
        publicSite: string;
        signedInAs: string;
        signOut: string;
        hubTitle: string;
        hubIntro: string;
        live: string;
        scheduled: string;
        facilitator: string;
        openEvent: string;
        noEvents: string;
        testEvents: string;
        testEventsHint: string;
        eventConsole: string;
        enterRoom: string;
        eventHealth: string;
        unavailableTitle: string;
        unavailableBody: string;
        recover: string;
    };
};

export const messages: Record<UiLocale, Messages> = {
    es: {
        language: { label: 'Idioma', spanish: 'Español', english: 'Inglés' },
        landing: {
            eyebrow: 'PROYECCIÓN ARMÓNICA · SESIÓN VIRTUAL',
            heroLead: 'El mito',
            heroAccent: 'está vivo.',
            lead: 'Una experiencia online en vivo para entrar en tu paisaje interior a través del cuerpo, el sonido y las imágenes que ya viven dentro tuyo.',
            portalLabel: 'el regreso',
            portalSub: 'PAGO → PRESENCIA',
            sessionsHeading: 'ELEGÍ TU PORTAL',
            loginHeading: '¿YA TENÉS TU ENTRADA?',
            terms: 'Términos y privacidad',
            staff: 'Ingreso del equipo',
            costaRica: 'Costa Rica',
            argentina: 'Argentina',
            buyTicket: 'Comprar entrada',
            salesSoon: 'Las entradas se abren en breve.',
            unavailable: 'Los horarios no están disponibles por el momento — tu código de entrada sigue funcionando.',
            noSessions: 'No hay sesiones programadas por el momento. Volvé a consultar pronto.',
            english: 'Inglés',
            spanish: 'Español',
            globalNorth: 'Norte Global',
            globalSouth: 'Sur Global',
        },
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
        session: {
            participantFallback: 'Participante',
            connection: { connected: 'Conectado', connecting: 'Conectando', reconnecting: 'Reconectando', disconnected: 'Desconectado' },
            connectingHeading: 'Conectando',
            connectingBody: 'Entrando al campo armónico…',
            connectionErrorHeading: 'Error de conexión',
            tryAgain: 'Intentar de nuevo',
            backToSessions: 'Volver a las sesiones',
            endedHeading: 'La sesión terminó',
            endedBody: 'Esta sesión terminó. Ya no estás conectado.',
            connectionLostHeading: 'Se perdió la conexión',
            connectionLostBody: 'Se perdió tu conexión con esta sesión.',
            disconnectedHeading: 'Desconectado',
            disconnectedBody: 'Ya no estás conectado a esta sesión. No podemos saber si terminó o si se cortó tu conexión.',
            rejoin: 'Volver a entrar',
            sessionFallback: 'Sesión',
            participantSingular: 'participante',
            participantPlural: 'participantes',
            signedIn: 'Ingresaste como',
            staffConsole: 'Escena y manos',
            audioActivationLabel: 'Activación de audio',
            audioPrompt: 'Presioná una vez para escuchar la sesión y el Beacon.',
            startAudio: 'Iniciar audio',
            beaconAudioError: 'No se pudo iniciar el audio del Beacon. Comprobá que esta pestaña no esté silenciada e intentá de nuevo.',
            audioError: 'No se pudo iniciar el audio. Comprobá que esta pestaña no esté silenciada e intentá de nuevo.',
            yourTurn: 'Tu turno — activá la cámara y el micrófono',
            invitationHeading: 'Te invitan a entrar en escena',
            invitationBody: 'Podés sumarte con cámara y micrófono, o quedarte en el público. Nada se activará hasta que aceptes.',
            acceptInvitation: 'Aceptar y entrar',
            declineInvitation: 'Ahora no',
            acceptingInvitation: 'Preparando cámara y micrófono…',
            decliningInvitation: 'Volviendo al público…',
            invitationDeviceError: 'Aceptaste la invitación, pero el navegador no pudo activar la cámara o el micrófono. Podés volver a intentarlo con los controles.',
            invitationDeclineError: 'No pudimos completar la vuelta al público. Intentá de nuevo.',
            masterVolume: 'Volumen general',
            mix: 'Mezcla de Beacon y sesión',
            sessionChannel: 'Sesión',
            beaconRoom: 'Sala Beacon',
            playlist: 'Playlist',
            live: 'En vivo',
            active: 'activo',
            none: 'ninguno',
            error: 'error',
            mic: 'Micrófono',
            muteMicrophone: 'Silenciar micrófono',
            unmuteMicrophone: 'Activar micrófono',
            camera: 'Cámara',
            turnCameraOff: 'Apagar cámara',
            turnCameraOn: 'Encender cámara',
            audioOnly: 'Solo audio',
            turnVideoOn: 'Volver a encender el video',
            switchToAudioOnly: 'Cambiar a solo audio',
            leave: 'Salir',
            leaveSession: 'Salir de la sesión',
            preparingRoom: 'Preparando tu sala',
            confirmingEntry: 'Confirmando tu entrada y el estado del evento…',
            entryUnavailable: 'No se pudo comprobar el ingreso',
            ticketConfirmed: 'Entrada confirmada',
            doorsClosed: 'Las puertas todavía están cerradas. Esta página te hará entrar automáticamente cuando el equipo las abra.',
            doorsReconnecting: 'Estamos recuperando la conexión para comprobar las puertas. Tu entrada sigue confirmada.',
            doorsChecking: 'Comprobando las puertas automáticamente…',
            cancelledHeading: 'Sesión cancelada',
            cancelledBody: 'Esta sesión no se realizará.',
            closingBody: 'Gracias por haber sido parte.',
        },
        hand: {
            staffCollision: 'Este navegador tiene una sesión del equipo abierta. Abrí la vista de participante en una ventana privada o en otro perfil del navegador.',
            unauthorized: 'Esta sesión de participante ya no está autorizada. Volvé a ingresar desde una ventana privada o desde otro perfil del navegador.',
            raiseFailed: 'No se pudo levantar la mano',
            lowerFailed: 'No se pudo bajar la mano',
            statusUnavailable: 'El estado de tu mano no está disponible',
            raise: 'Levantar la mano',
            lower: 'Bajar la mano',
            onStage: 'Estás en escena — activá el micrófono y la cámara abajo.',
            queuedPrefix: 'Mano levantada — sos la persona número',
            queuedSuffix: 'en la fila.',
        },
        stage: {
            label: 'Escena',
            audioOnly: 'Modo solo audio. El video está apagado; seguís escuchando la escena y el Beacon.',
            waiting: 'Esperando que la persona facilitadora abra la escena.',
            you: 'vos',
            connecting: 'Conectando…',
            cameraOff: 'Cámara apagada',
            microphoneMuted: 'micrófono silenciado',
            quality: { excellent: 'conexión excelente', good: 'conexión buena', poor: 'conexión débil', lost: 'conexión perdida', unknown: 'conexión desconocida' },
        },
        tapestry: {
            label: 'Tapiz',
            latestAlt: 'Último tapiz de participantes',
            waiting: 'Esperando imágenes.',
            stopCamera: 'Dejar de compartir la cámara con el tapiz',
            shareSnapshot: 'Compartir una imagen de cámara',
            permissionDenied: 'No se otorgó permiso para usar la cámara. Igual podés participar de la sesión.',
        },
        staffRoles: {
            FACILITATOR: 'Facilitador/a',
            FACILITATOR_OP: 'Facilitación y operaciones',
            OPERATOR: 'Operaciones',
            ADMIN: 'Administración',
        },
        ops: {
            brand: 'Beacon · Equipo',
            events: 'Eventos',
            health: 'Estado técnico',
            admission: 'Entradas',
            publicSite: 'Sitio público',
            signedInAs: 'Sesión de equipo',
            signOut: 'Cerrar sesión',
            hubTitle: 'Eventos',
            hubIntro: 'Entrá a un evento para dirigir la escena, abrir la sala y acompañar a sus participantes.',
            live: 'En vivo',
            scheduled: 'Próximo',
            facilitator: 'Facilitación',
            openEvent: 'Abrir evento',
            noEvents: 'No tenés eventos activos o próximos disponibles.',
            testEvents: 'Eventos de prueba',
            testEventsHint: 'Fixtures internos, separados de la programación pública.',
            eventConsole: 'Conducción del evento',
            enterRoom: 'Entrar a la sala',
            eventHealth: 'Estado del evento',
            unavailableTitle: 'Este evento no está disponible',
            unavailableBody: 'El enlace puede estar vencido o pertenecer a otro equipo. No se mostraron datos del evento.',
            recover: 'Volver a tus eventos',
        },
    },
    en: {
        language: { label: 'Language', spanish: 'Spanish', english: 'English' },
        landing: {
            eyebrow: 'HARMONIC PROJECTION · VIRTUAL SESSION',
            heroLead: 'The myth',
            heroAccent: 'is alive.',
            lead: 'A live online experience to enter your inner landscape through body, sound, and the images already living inside you.',
            portalLabel: 'the return',
            portalSub: 'PAYMENT → PRESENCE',
            sessionsHeading: 'CHOOSE YOUR PORTAL',
            loginHeading: 'ALREADY HAVE A TICKET?',
            terms: 'Terms & privacy',
            staff: 'Staff sign-in',
            costaRica: 'Costa Rica',
            argentina: 'Argentina',
            buyTicket: 'Buy a ticket',
            salesSoon: 'Ticket sales open shortly.',
            unavailable: 'Session times are temporarily unavailable — your ticket code still works.',
            noSessions: 'No sessions are currently scheduled. Check back soon.',
            english: 'English',
            spanish: 'Spanish',
            globalNorth: 'Global North',
            globalSouth: 'Global South',
        },
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
        session: {
            participantFallback: 'Participant',
            connection: { connected: 'Connected', connecting: 'Connecting', reconnecting: 'Reconnecting', disconnected: 'Disconnected' },
            connectingHeading: 'Connecting',
            connectingBody: 'Entering the Harmonic field…',
            connectionErrorHeading: 'Connection error',
            tryAgain: 'Try again',
            backToSessions: 'Back to sessions',
            endedHeading: 'Session ended',
            endedBody: "This session has ended. You're no longer connected.",
            connectionLostHeading: 'Connection lost',
            connectionLostBody: 'Your connection to this session was lost.',
            disconnectedHeading: 'Disconnected',
            disconnectedBody: "You're no longer connected to this session. We can't tell whether it ended or your connection dropped.",
            rejoin: 'Rejoin',
            sessionFallback: 'Session',
            participantSingular: 'participant',
            participantPlural: 'participants',
            signedIn: 'Signed in as',
            staffConsole: 'Stage and hands',
            audioActivationLabel: 'Audio activation',
            audioPrompt: 'Press once to hear the session and Beacon.',
            startAudio: 'Start audio',
            beaconAudioError: 'Beacon audio could not start. Check that this tab is not muted, then try again.',
            audioError: 'Audio could not start. Check that this tab is not muted, then try again.',
            yourTurn: 'Your turn — enable camera and microphone',
            invitationHeading: 'You’re invited into the scene',
            invitationBody: 'You can join with camera and microphone, or remain in the audience. Nothing will turn on until you accept.',
            acceptInvitation: 'Accept and join',
            declineInvitation: 'Not now',
            acceptingInvitation: 'Preparing camera and microphone…',
            decliningInvitation: 'Returning to the audience…',
            invitationDeviceError: 'You accepted, but the browser could not turn on the camera or microphone. You can retry with the controls.',
            invitationDeclineError: 'We could not complete your return to the audience. Try again.',
            masterVolume: 'Master volume',
            mix: 'Beacon and session mix',
            sessionChannel: 'Session',
            beaconRoom: 'Beacon room',
            playlist: 'Playlist',
            live: 'Live',
            active: 'active',
            none: 'none',
            error: 'error',
            mic: 'Mic',
            muteMicrophone: 'Mute microphone',
            unmuteMicrophone: 'Unmute microphone',
            camera: 'Camera',
            turnCameraOff: 'Turn camera off',
            turnCameraOn: 'Turn camera on',
            audioOnly: 'Audio only',
            turnVideoOn: 'Turn video back on',
            switchToAudioOnly: 'Switch to audio only',
            leave: 'Leave',
            leaveSession: 'Leave session',
            preparingRoom: 'Preparing your room',
            confirmingEntry: 'Confirming your ticket and event status…',
            entryUnavailable: 'Entry status unavailable',
            ticketConfirmed: 'Ticket confirmed',
            doorsClosed: 'The doors are not open yet. This page will bring you in automatically when the team opens them.',
            doorsReconnecting: 'We are reconnecting to check the doors. Your ticket remains confirmed.',
            doorsChecking: 'Checking the doors automatically…',
            cancelledHeading: 'Session cancelled',
            cancelledBody: 'This session will not take place.',
            closingBody: 'Thank you for being part of it.',
        },
        hand: {
            staffCollision: 'This browser is signed in as staff. Open the attendee view in a private window or separate browser profile.',
            unauthorized: 'This attendee session is no longer authorized. Sign in again in a private window or separate browser profile.',
            raiseFailed: 'Could not raise hand',
            lowerFailed: 'Could not lower hand',
            statusUnavailable: 'Hand status unavailable',
            raise: 'Raise hand',
            lower: 'Lower hand',
            onStage: 'You are on stage — enable microphone and camera below.',
            queuedPrefix: 'Hand raised — you are number',
            queuedSuffix: 'in the queue.',
        },
        stage: {
            label: 'Stage',
            audioOnly: 'Audio-only mode. Video is off; you are still hearing the stage and the Beacon bed.',
            waiting: 'Waiting for the facilitator to open the stage.',
            you: 'you',
            connecting: 'Connecting…',
            cameraOff: 'Camera off',
            microphoneMuted: 'microphone muted',
            quality: { excellent: 'connection excellent', good: 'connection good', poor: 'connection poor', lost: 'connection lost', unknown: 'connection unknown' },
        },
        tapestry: {
            label: 'Tapestry',
            latestAlt: 'Latest participant tapestry',
            waiting: 'Waiting for snapshots.',
            stopCamera: 'Stop sharing your camera with the tapestry',
            shareSnapshot: 'Share a camera snapshot',
            permissionDenied: 'Camera permission was not granted. You can still take part in the session.',
        },
        staffRoles: {
            FACILITATOR: 'Facilitator',
            FACILITATOR_OP: 'Facilitator and operations',
            OPERATOR: 'Operations',
            ADMIN: 'Administration',
        },
        ops: {
            brand: 'Beacon · Staff',
            events: 'Events',
            health: 'System health',
            admission: 'Admission',
            publicSite: 'Public site',
            signedInAs: 'Staff session',
            signOut: 'Sign out',
            hubTitle: 'Events',
            hubIntro: 'Enter an event to conduct the scene, open the room, and support its participants.',
            live: 'Live',
            scheduled: 'Upcoming',
            facilitator: 'Facilitator',
            openEvent: 'Open event',
            noEvents: 'You have no active or upcoming events available.',
            testEvents: 'Test events',
            testEventsHint: 'Internal fixtures, kept separate from the public programme.',
            eventConsole: 'Event conductor',
            enterRoom: 'Enter the room',
            eventHealth: 'Event health',
            unavailableTitle: 'This event is unavailable',
            unavailableBody: 'The link may be stale or belong to another team. No event details were disclosed.',
            recover: 'Return to your events',
        },
    },
};

export function staffRoleLabel(copy: Messages, role: LocalizedStaffRole): string {
    return copy.staffRoles[role];
}
