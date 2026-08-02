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
        connectionUnavailable: string;
        tryAgain: string;
        backToSessions: string;
        endedHeading: string;
        endedBody: string;
        connectionLostHeading: string;
        connectionLostBody: string;
        duplicateIdentityHeading: string;
        duplicateIdentityBody: string;
        disconnectedHeading: string;
        disconnectedBody: string;
        rejoin: string;
        sessionFallback: string;
        participantSingular: string;
        participantPlural: string;
        peopleInRoom: string;
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
        invitationCameraError: string;
        invitationMicrophoneError: string;
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
        frontCamera: string;
        rearCamera: string;
        switchToFrontCamera: string;
        switchToRearCamera: string;
        switchingCamera: string;
        cameraSwitchError: string;
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
        audioOnlyTile: string;
        waiting: string;
        you: string;
        protagonist: string;
        facilitator: string;
        holder: string;
        connecting: string;
        cameraOff: string;
        presentWithoutCamera: string;
        reconnecting: string;
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
        lifecycle: {
            heading: string;
            status: string;
            scheduled: string;
            statuses: Record<'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED', string>;
            opening: string;
            openDoors: string;
            closeEvent: string;
            disconnectRemaining: string;
            outsideWindowOverride: string;
            outsideWindowRestricted: string;
            reasonLabel: string;
            confirmHeading: string;
            confirmBody: string;
            disconnecting: string;
            endAndDisconnect: string;
            keepOpen: string;
            doorsAlreadyOpen: string;
            doorsOpened: string;
            eventEnded: string;
            eventCancelled: string;
            disconnectIncomplete: string;
            statusChangeFailed: string;
        };
        spotlight: {
            pollingFailed: string;
            liveStateUnavailable: string;
            reconciliationOne: string;
            reconciliationMany: string;
            requestFailed: string;
            endpointUnavailable: string;
            participantDisconnected: string;
            hasFloor: string;
            invitedNotice: string;
            removedNotice: string;
            handLoweredNotice: string;
            trackMutedNotice: string;
            reconciliationFinished: string;
            stageFull: string;
            livekitFailure: string;
            stageSummary: string;
            slotsReserved: string;
            handsRaised: string;
            reconcile: string;
            handQueue: string;
            handQueueHelp: string;
            noHands: string;
            waiting: string;
            connected: string;
            disconnected: string;
            liveUnknown: string;
            quality: string;
            reconcileNeeded: string;
            giveFloor: string;
            waitingForReconnect: string;
            removeHand: string;
            mustReconnect: string;
            invitedHeading: string;
            noInvitations: string;
            inviteAfterReentry: string;
            unknownGrant: string;
            awaitingAcceptance: string;
            cancelInvitation: string;
            reservedFacilitator: string;
            onStage: string;
            nobodyOnStage: string;
            noTracks: string;
            muted: string;
            trackLive: string;
            participantMustEnable: string;
            muteTrack: string;
            takeFloor: string;
            audience: string;
            noAudience: string;
            inviteToStage: string;
            recentSnapshotAlt: string;
            noSnapshotAlt: string;
            noImage: string;
            footer: string;
        };
        healthPanel: {
            pageTitle: string;
            pageIntro: string;
            headlines: Record<'green' | 'yellow' | 'red', string>;
            levels: Record<'green' | 'yellow' | 'red', string>;
            sessionStatuses: Record<'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED', string>;
            checks: Record<'postgres' | 'livekit' | 'stageRoom' | 'publisherGrants' | 'bedPublisher' | 'tapestry', string>;
            endpointHttp: string;
            endpointUnavailable: string;
            endpointAlarm: string;
            checking: string;
            noReport: string;
            watchingSession: string;
            signedInAs: string;
            noSession: string;
            lastChecked: string;
            refreshesEvery: string;
            waitingFirstReport: string;
            refreshNow: string;
        };
        admissionPanel: {
            pageTitle: string;
            pageIntro: string;
            unexpectedError: string;
            notices: {
                noMatches: string;
                accessRevoked: string;
                suspensionCleared: string;
                bindingUpdated: string;
                batchGenerated: string;
                importComplete: string;
                compIssued: string;
                invitationReady: string;
                invitationSwitchOff: string;
                invitationCleanupFailed: string;
                invitationDisabled: string;
            };
            lookup: {
                heading: string;
                placeholder: string;
                action: string;
            };
            labels: {
                state: string;
                tier: string;
                lastFour: string;
                boundEmail: string;
                event: string;
                expires: string;
                commerce: string;
                admin: string;
                media: string;
                invitation: string;
                campaign: string;
                redeemed: string;
                revoked: string;
                cap: string;
            };
            actions: {
                reason: string;
                newEmail: string;
                rebind: string;
                clearBinding: string;
                resume: string;
                suspend: string;
                revoke: string;
            };
            tickets: {
                heading: string;
                eventLabel: string;
                batchHeading: string;
                tierLabel: string;
                globalNorth: string;
                globalSouth: string;
                generate: string;
                importPlaceholder: string;
                importAction: string;
                overrideHeading: string;
                overrideTier: string;
                comp: string;
                supportOverride: string;
                overrideReason: string;
                issue: string;
            };
            invitations: {
                heading: string;
                help: string;
                load: string;
                refresh: string;
                redemptionStatus: string;
                on: string;
                off: string;
                createHeading: string;
                internalLabel: string;
                internalPlaceholder: string;
                humanCode: string;
                expiresWithin: string;
                capacity: string;
                create: string;
                none: string;
                redeemedCount: string;
                expires: string;
                disableReason: string;
                revokeDerived: string;
                disable: string;
                retryDisconnect: string;
            };
            export: {
                heading: string;
                warning: string;
                download: string;
            };
            values: Record<'ISSUED' | 'BOUND' | 'REVOKED' | 'EXPIRED' | 'ACTIVE' | 'DISABLED' | 'CLEAR' | 'SUSPENDED' | 'NOT_REQUIRED' | 'RECONCILIATION_REQUIRED' | 'DISCONNECTED', string>;
            tiers: Record<'GLOBAL_NORTH' | 'GLOBAL_SOUTH' | 'COMP' | 'SUPPORT_OVERRIDE', string>;
        };
        tapestryArrange: {
            heading: string;
            saving: string;
            save: string;
            saved: string;
            saveFailed: string;
            empty: string;
            tileAlt: string;
            moveLeft: string;
            moveRight: string;
        };
        cockpit: {
            roomTitle: string;
            roomHint: string;
            door: string;
            hands: string;
            stage: string;
            primary: string;
            healthSignal: string;
            open: string;
            closed: string;
            next: string;
            noHands: string;
            manageHands: string;
            inspectStage: string;
            reconcileStage: string;
            inspectStageConnection: string;
            inspectHealth: string;
            openDoors: string;
            doorsPanel: string;
            handsPanel: string;
            tapestryPanel: string;
            admissionPanel: string;
            healthPanel: string;
            closePanel: string;
            returnToRoom: string;
            tools: string;
        };
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
            portalLabel: 'el umbral',
            portalSub: 'ENTRADA → PRESENCIA',
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
            ticketCodeHint: 'Exactamente como aparece en tu entrada o invitación',
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
            connectionUnavailable: 'No pudimos entrar a la sala. Tu acceso sigue confirmado; intentá de nuevo.',
            tryAgain: 'Intentar de nuevo',
            backToSessions: 'Volver a las sesiones',
            endedHeading: 'La sesión terminó',
            endedBody: 'Esta sesión terminó. Ya no estás conectado.',
            connectionLostHeading: 'Se perdió la conexión',
            connectionLostBody: 'Se perdió tu conexión con esta sesión.',
            duplicateIdentityHeading: 'Esta entrada está abierta en otro lugar',
            duplicateIdentityBody: 'El mismo acceso se abrió en otra pestaña o dispositivo. Cerralo allí y después volvé a entrar acá.',
            disconnectedHeading: 'Desconectado',
            disconnectedBody: 'Ya no estás conectado a esta sesión. No podemos saber si terminó o si se cortó tu conexión.',
            rejoin: 'Volver a entrar',
            sessionFallback: 'Sesión',
            participantSingular: 'participante',
            participantPlural: 'participantes',
            peopleInRoom: 'Personas en la sala (incluyéndote)',
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
            invitationDeviceError: 'Aceptaste la invitación, pero el navegador no pudo activar la cámara ni el micrófono. Revisá ambos permisos y volvé a intentarlo con los controles.',
            invitationCameraError: 'El micrófono está activo, pero la cámara no pudo encenderse. Revisá el permiso de cámara y volvé a intentarlo.',
            invitationMicrophoneError: 'La cámara está activa, pero el micrófono no pudo encenderse. Revisá el permiso de micrófono y volvé a intentarlo.',
            invitationDeclineError: 'No pudimos completar la vuelta al público. Intentá de nuevo.',
            masterVolume: 'Volumen general de la sala',
            mix: 'Balance Beacon / Sesión',
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
            frontCamera: 'Cámara frontal',
            rearCamera: 'Cámara trasera',
            switchToFrontCamera: 'Cambiar a cámara frontal',
            switchToRearCamera: 'Cambiar a cámara trasera',
            switchingCamera: 'Cambiando cámara…',
            cameraSwitchError: 'No pudimos cambiar de cámara. La sesión y el audio siguen conectados; intentá de nuevo.',
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
            audioOnlyTile: 'Solo audio',
            waiting: 'Esperando que la persona facilitadora abra la escena.',
            you: 'vos',
            protagonist: 'protagonista',
            facilitator: 'facilitación',
            holder: 'acompaña la escena',
            connecting: 'Conectando…',
            cameraOff: 'Cámara apagada',
            presentWithoutCamera: 'Presente sin cámara',
            reconnecting: 'Reconectando…',
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
            lifecycle: {
                heading: 'Puertas del evento',
                status: 'Estado',
                scheduled: 'programado para',
                statuses: {
                    SCHEDULED: 'Próximo',
                    LIVE: 'En vivo',
                    ENDED: 'Finalizado',
                    CANCELLED: 'Cancelado',
                },
                opening: 'Abriendo…',
                openDoors: 'Abrir puertas',
                closeEvent: 'Cerrar evento',
                disconnectRemaining: 'Desconectar conexiones restantes',
                outsideWindowOverride: 'Estás fuera del horario normal de apertura. Hace falta dejar un motivo de auditoría.',
                outsideWindowRestricted: 'Las puertas se pueden abrir desde 10 minutos antes hasta 60 minutos después del horario programado.',
                reasonLabel: 'Motivo operativo (sin datos de participantes)',
                confirmHeading: '¿Finalizar esta experiencia para todas las personas?',
                confirmBody: 'Primero se detienen los nuevos ingresos. Luego se desconectan de inmediato la Escena y quienes escuchan el Beacon de este evento. Los demás eventos y la fuente del Beacon siguen en línea.',
                disconnecting: 'Desconectando…',
                endAndDisconnect: 'Finalizar y desconectar a todas las personas',
                keepOpen: 'Mantener abierto',
                doorsAlreadyOpen: 'Las puertas ya estaban abiertas.',
                doorsOpened: 'Las puertas están abiertas. Las personas ya pueden entrar.',
                eventEnded: 'Evento finalizado. Se desconectaron {stage} conexiones de Escena y {beacon} del Beacon.',
                eventCancelled: 'Evento cancelado. Se desconectaron {stage} conexiones de Escena y {beacon} del Beacon.',
                disconnectIncomplete: 'El evento se cerró, pero quedaron conexiones activas. Usá “Desconectar conexiones restantes” para volver a intentarlo.',
                statusChangeFailed: 'No se pudo cambiar el estado del evento',
            },
            spotlight: {
                pollingFailed: 'No se pudo actualizar ({error}). Se muestra el último estado conocido y se vuelve a intentar cada {seconds}s.',
                liveStateUnavailable: 'LiveKit no está respondiendo: no se puede confirmar presencia ni medios. Las invitaciones y la fila de manos guardadas siguen vigentes.',
                reconciliationOne: '1 persona necesita reconciliación: el permiso guardado y LiveKit no coinciden.',
                reconciliationMany: '{count} personas necesitan reconciliación: los permisos guardados y LiveKit no coinciden.',
                requestFailed: 'La acción no se pudo completar (HTTP {status})',
                endpointUnavailable: 'No se pudo contactar el control de escena',
                participantDisconnected: 'Esta persona no está conectada. Esperá su regreso o quitá la mano de la fila.',
                hasFloor: '{name} tiene la palabra',
                invitedNotice: '{name} recibió una invitación a la escena',
                removedNotice: '{name} volvió al público',
                handLoweredNotice: 'Se bajó la mano de {name}',
                trackMutedNotice: 'Se silenció {track}; la persona puede volver a activarlo',
                reconciliationFinished: 'Reconciliación terminada',
                stageFull: 'La escena está completa. Esta mano conserva el puesto #{position}; liberá un lugar primero.',
                livekitFailure: '{message}. Se revocó el permiso guardado; usá Reconciliar para volver a intentar en LiveKit.',
                stageSummary: 'Escena: {active}/{max} publicando',
                slotsReserved: '{granted}/{max} lugares reservados',
                handsRaised: '{count} manos levantadas',
                reconcile: 'Reconciliar permisos',
                handQueue: 'Fila de manos',
                handQueueHelp: 'Las manos aparecen automáticamente. Dar la palabra invita a una persona conectada; Quitar mano limpia la solicitud. Las miniaturas son privadas, se actualizan juntas y desaparecen después de {seconds}s sin una nueva imagen consentida.',
                noHands: 'No hay manos levantadas.',
                waiting: 'espera',
                connected: 'conectada',
                disconnected: 'salió',
                liveUnknown: 'presencia desconocida',
                quality: 'calidad',
                reconcileNeeded: 'requiere reconciliación',
                giveFloor: 'Dar la palabra',
                waitingForReconnect: 'Esperando reconexión',
                removeHand: 'Quitar mano',
                mustReconnect: 'La persona debe estar conectada antes de entrar en escena',
                invitedHeading: 'Invitadas / reconectando',
                noInvitations: 'No hay invitaciones pendientes.',
                inviteAfterReentry: 'Desconectada: la invitación volverá a mostrarse cuando regrese',
                unknownGrant: 'Estado en vivo desconocido: la invitación sigue vigente',
                awaitingAcceptance: 'Conectada: esperando aceptación y medios',
                cancelInvitation: 'Cancelar invitación',
                reservedFacilitator: 'Lugar reservado para facilitación',
                onStage: 'En escena',
                nobodyOnStage: 'Todavía nadie tiene la palabra.',
                noTracks: 'sin medios publicados',
                muted: 'silenciado',
                trackLive: 'activo',
                participantMustEnable: 'La persona debe volver a activar {track}',
                muteTrack: 'Silenciar {track}',
                takeFloor: 'Quitar la palabra',
                audience: 'Público ({count})',
                noAudience: 'No hay otras personas.',
                inviteToStage: 'Invitar a la escena',
                recentSnapshotAlt: 'Imagen reciente del tapiz de {name}',
                noSnapshotAlt: '{name}: sin imagen actual del tapiz',
                noImage: 'sin imagen',
                footer: 'Sesión de {role}. La fila se actualiza cada {seconds}s; los permisos guardados son la referencia.',
            },
            healthPanel: {
                pageTitle: 'Salud del evento',
                pageIntro: 'Estado en vivo de los subsistemas del evento. Rojo impide abrir; amarillo indica un componente prescindible. Los procedimientos ante fallas están en',
                headlines: {
                    green: 'VERDE — todos los subsistemas funcionan normalmente',
                    yellow: 'AMARILLO — hay una falla degradada y prescindible',
                    red: 'ROJO — hay una falla que impide abrir el evento',
                },
                levels: { green: 'verde', yellow: 'amarillo', red: 'rojo' },
                sessionStatuses: {
                    SCHEDULED: 'Próximo',
                    LIVE: 'En vivo',
                    ENDED: 'Finalizado',
                    CANCELLED: 'Cancelado',
                },
                checks: {
                    postgres: 'PostgreSQL',
                    livekit: 'API de LiveKit',
                    stageRoom: 'Sala de Escena',
                    publisherGrants: 'Permisos de publicación',
                    bedPublisher: 'Fuente del Beacon (playlist bot)',
                    tapestry: 'Tapiz (prescindible)',
                },
                endpointHttp: 'El endpoint respondió HTTP {status}',
                endpointUnavailable: 'No se pudo contactar el endpoint de salud',
                endpointAlarm: 'ROJO — no se puede consultar la salud: {error}',
                checking: 'Comprobando subsistemas…',
                noReport: 'AMARILLO — todavía no hay informe',
                watchingSession: 'Observando la sesión',
                signedInAs: 'identidad activa:',
                noSession: 'No se está observando ninguna sesión programada o en vivo',
                lastChecked: 'Última comprobación',
                refreshesEvery: 'se actualiza cada {seconds}s',
                waitingFirstReport: 'Esperando el primer informe…',
                refreshNow: 'Actualizar ahora',
            },
            admissionPanel: {
                pageTitle: 'Soporte de entradas',
                pageIntro: 'Sesión de {name} ({role}). Toda modificación exige un motivo sin datos personales y queda auditada.',
                unexpectedError: 'Error inesperado',
                notices: {
                    noMatches: 'No se encontraron accesos.',
                    accessRevoked: 'El acceso fue suspendido o revocado.',
                    suspensionCleared: 'Se levantó la suspensión administrativa.',
                    bindingUpdated: 'Se actualizó la vinculación.',
                    batchGenerated: 'Lote generado. Copiá o descargá el CSV ahora: se muestra una sola vez.',
                    importComplete: 'Importación terminada: {created} creados, {skipped} omitidos porque ya existían.',
                    compIssued: 'Cortesía o excepción emitida. Copiá o descargá el CSV ahora: se muestra una sola vez.',
                    invitationReady: 'Invitación creada y lista para usar.',
                    invitationSwitchOff: 'Invitación creada, pero el canje público global sigue DESACTIVADO.',
                    invitationCleanupFailed: 'Invitación desactivada y accesos revocados; algunas conexiones en vivo requieren otro intento.',
                    invitationDisabled: 'Invitación desactivada. Se revocaron {count} accesos derivados.',
                },
                lookup: {
                    heading: 'Buscar entrada',
                    placeholder: 'Email, últimos cuatro caracteres del código o ID de acceso',
                    action: 'Buscar',
                },
                labels: {
                    state: 'Estado:',
                    tier: 'Tipo:',
                    lastFour: 'Últimos cuatro:',
                    boundEmail: 'Email vinculado:',
                    event: 'Evento:',
                    expires: 'Vence:',
                    commerce: 'Comercio:',
                    admin: 'administración',
                    media: 'medios',
                    invitation: 'Invitación:',
                    campaign: 'campaña',
                    redeemed: 'canjeada',
                    revoked: 'Revocada',
                    cap: 'cupo',
                },
                actions: {
                    reason: 'Motivo (obligatorio, sin datos personales)',
                    newEmail: 'Nuevo email (opcional)',
                    rebind: 'Vincular al email',
                    clearBinding: 'Quitar vinculación',
                    resume: 'Reactivar acceso',
                    suspend: 'Suspender acceso',
                    revoke: 'Revocar',
                },
                tickets: {
                    heading: 'Emitir entradas',
                    eventLabel: 'Evento',
                    batchHeading: 'Lote (ADMIN)',
                    tierLabel: 'Tipo de entrada',
                    globalNorth: 'Norte Global (USD 50)',
                    globalSouth: 'Sur Global (USD 20)',
                    generate: 'Generar lote',
                    importPlaceholder: 'Pegá el CSV de la plataforma (columna code; encabezado opcional)',
                    importAction: 'Importar CSV (idempotente)',
                    overrideHeading: 'Cortesía / excepción de soporte',
                    overrideTier: 'Tipo de excepción',
                    comp: 'Cortesía',
                    supportOverride: 'Excepción de soporte',
                    overrideReason: 'Motivo (obligatorio, sin datos personales; por ejemplo, referencia del caso)',
                    issue: 'Emitir',
                },
                invitations: {
                    heading: 'Invitaciones controladas',
                    help: 'Un código breve genera el mismo acceso de cortesía, limitado a esta sesión, que una entrada normal. Sólo se guarda su huella; se controlan cupo, vencimiento y revocación.',
                    load: 'Cargar invitaciones',
                    refresh: 'Actualizar',
                    redemptionStatus: 'El canje público está {status}.',
                    on: 'ACTIVADO',
                    off: 'DESACTIVADO',
                    createHeading: 'Crear invitación limitada',
                    internalLabel: 'Etiqueta interna (nunca el código)',
                    internalPlaceholder: 'Lista de invitados — mañana ES',
                    humanCode: 'Código para personas (6–15 caracteres)',
                    expiresWithin: 'Vence (dentro de siete días)',
                    capacity: 'Cupo de canjes',
                    create: 'Crear invitación',
                    none: 'No hay invitaciones creadas.',
                    redeemedCount: '{count}/{max} canjeadas',
                    expires: 'vence',
                    disableReason: 'Motivo de desactivación (obligatorio, sin datos personales)',
                    revokeDerived: 'Revocar también todos los accesos ya canjeados y desconectar sus medios en vivo.',
                    disable: 'Desactivar invitación',
                    retryDisconnect: 'Reintentar revocación / desconexión',
                },
                export: {
                    heading: 'Exportación única de códigos',
                    warning: 'Estos códigos se muestran una sola vez y la aplicación nunca los guarda en texto plano. Guardá ahora el CSV bajo control operativo; no lo subas al repositorio ni lo pegues en issues o chats.',
                    download: 'Descargar CSV',
                },
                values: {
                    ISSUED: 'Emitida',
                    BOUND: 'Vinculada',
                    REVOKED: 'Revocada',
                    EXPIRED: 'Vencida',
                    ACTIVE: 'Activa',
                    DISABLED: 'Desactivada',
                    CLEAR: 'Sin suspensión',
                    SUSPENDED: 'Suspendida',
                    NOT_REQUIRED: 'No requerido',
                    RECONCILIATION_REQUIRED: 'Requiere reconciliación',
                    DISCONNECTED: 'Desconectado',
                },
                tiers: {
                    GLOBAL_NORTH: 'Norte Global',
                    GLOBAL_SOUTH: 'Sur Global',
                    COMP: 'Cortesía',
                    SUPPORT_OVERRIDE: 'Excepción de soporte',
                },
            },
            tapestryArrange: {
                heading: 'Orden del tapiz',
                saving: 'Guardando…',
                save: 'Guardar orden',
                saved: 'Guardado',
                saveFailed: 'No se pudo guardar el orden. Volvé a intentarlo.',
                empty: 'Todavía no hay imágenes: las teselas aparecen cuando se suman cámaras.',
                tileAlt: 'Tesela {index} del tapiz',
                moveLeft: 'Mover tesela {index} a la izquierda',
                moveRight: 'Mover tesela {index} a la derecha',
            },
            cockpit: {
                roomTitle: 'Sala en vivo',
                roomHint: 'La escena permanece conectada mientras abrís las herramientas.',
                door: 'Puerta',
                hands: 'Manos',
                stage: 'Personas en escena',
                primary: 'Siguiente acción',
                healthSignal: 'Salud',
                open: 'Abierta',
                closed: 'Cerrada',
                next: 'Sigue',
                noHands: 'Sin manos',
                manageHands: 'Atender la próxima mano',
                inspectStage: 'Revisar la escena',
                reconcileStage: 'Reconciliar la escena',
                inspectStageConnection: 'Revisar conexión de escena',
                inspectHealth: 'Revisar estado técnico',
                openDoors: 'Abrir puertas',
                doorsPanel: 'Puertas del evento',
                handsPanel: 'Manos, escena y público',
                tapestryPanel: 'Composición del tapiz',
                admissionPanel: 'Soporte de entradas',
                healthPanel: 'Estado técnico',
                closePanel: 'Cerrar herramienta',
                returnToRoom: 'Volver a la sala en vivo',
                tools: 'Herramientas',
            },
        },
    },
    en: {
        language: { label: 'Language', spanish: 'Spanish', english: 'English' },
        landing: {
            eyebrow: 'HARMONIC PROJECTION · VIRTUAL SESSION',
            heroLead: 'The myth',
            heroAccent: 'is alive.',
            lead: 'A live online experience to enter your inner landscape through body, sound, and the images already living inside you.',
            portalLabel: 'the threshold',
            portalSub: 'ENTRY → PRESENCE',
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
            ticketCodeHint: 'Exactly as it appears on your ticket or invitation',
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
            connectionUnavailable: 'We could not enter the room. Your access is still confirmed; try again.',
            tryAgain: 'Try again',
            backToSessions: 'Back to sessions',
            endedHeading: 'Session ended',
            endedBody: "This session has ended. You're no longer connected.",
            connectionLostHeading: 'Connection lost',
            connectionLostBody: 'Your connection to this session was lost.',
            duplicateIdentityHeading: 'This access is open elsewhere',
            duplicateIdentityBody: 'The same access was opened in another tab or device. Close it there, then rejoin here.',
            disconnectedHeading: 'Disconnected',
            disconnectedBody: "You're no longer connected to this session. We can't tell whether it ended or your connection dropped.",
            rejoin: 'Rejoin',
            sessionFallback: 'Session',
            participantSingular: 'participant',
            participantPlural: 'participants',
            peopleInRoom: 'People in the room (including you)',
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
            invitationDeviceError: 'You accepted, but the browser could not turn on the camera or microphone. Check both permissions and retry with the controls.',
            invitationCameraError: 'The microphone is on, but the camera could not start. Check camera permission and try again.',
            invitationMicrophoneError: 'The camera is on, but the microphone could not start. Check microphone permission and try again.',
            invitationDeclineError: 'We could not complete your return to the audience. Try again.',
            masterVolume: 'Overall room volume',
            mix: 'Beacon / Session balance',
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
            frontCamera: 'Front camera',
            rearCamera: 'Rear camera',
            switchToFrontCamera: 'Switch to front camera',
            switchToRearCamera: 'Switch to rear camera',
            switchingCamera: 'Switching camera…',
            cameraSwitchError: 'We could not switch cameras. Your session and audio are still connected; try again.',
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
            audioOnlyTile: 'Audio only',
            waiting: 'Waiting for the facilitator to open the stage.',
            you: 'you',
            protagonist: 'protagonist',
            facilitator: 'facilitator',
            holder: 'holding the scene',
            connecting: 'Connecting…',
            cameraOff: 'Camera off',
            presentWithoutCamera: 'Present without camera',
            reconnecting: 'Reconnecting…',
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
            lifecycle: {
                heading: 'Event doors',
                status: 'Status',
                scheduled: 'scheduled',
                statuses: {
                    SCHEDULED: 'Upcoming',
                    LIVE: 'Live',
                    ENDED: 'Ended',
                    CANCELLED: 'Cancelled',
                },
                opening: 'Opening…',
                openDoors: 'Open doors',
                closeEvent: 'Close event',
                disconnectRemaining: 'Disconnect remaining clients',
                outsideWindowOverride: 'This is outside the normal opening window. An audit reason is required.',
                outsideWindowRestricted: 'Doors can open from 10 minutes before until 60 minutes after the scheduled start.',
                reasonLabel: 'Operational reason (do not include attendee details)',
                confirmHeading: 'End this experience for everyone?',
                confirmBody: 'New entries stop first. Then every Stage connection and this event’s Beacon listeners are disconnected immediately. Other events and the Beacon source stay online.',
                disconnecting: 'Disconnecting…',
                endAndDisconnect: 'End & disconnect everyone',
                keepOpen: 'Keep open',
                doorsAlreadyOpen: 'Doors were already open.',
                doorsOpened: 'Doors are open. Attendees are entering now.',
                eventEnded: 'Event ended now. Disconnected {stage} Stage and {beacon} Beacon connections.',
                eventCancelled: 'Event cancelled now. Disconnected {stage} Stage and {beacon} Beacon connections.',
                disconnectIncomplete: 'Event closed, but an immediate media disconnect was incomplete. Use “Disconnect remaining clients” to retry.',
                statusChangeFailed: 'Status change failed',
            },
            spotlight: {
                pollingFailed: 'Update failed ({error}). Showing the last known state and retrying every {seconds}s.',
                liveStateUnavailable: 'LiveKit live state unavailable — connection and media are unknown. Durable grants and the hand queue are still current.',
                reconciliationOne: '1 participant needs reconciliation: the saved grant and LiveKit disagree.',
                reconciliationMany: '{count} participants need reconciliation: the saved grants and LiveKit disagree.',
                requestFailed: 'The action could not be completed (HTTP {status})',
                endpointUnavailable: 'The stage control could not be reached',
                participantDisconnected: 'This participant is not connected. Wait for them to rejoin or remove the stale hand.',
                hasFloor: '{name} has the floor',
                invitedNotice: '{name} was invited to the stage',
                removedNotice: '{name} returned to the audience',
                handLoweredNotice: '{name}’s hand was lowered',
                trackMutedNotice: '{track} muted; the participant can re-enable it',
                reconciliationFinished: 'Reconciliation finished',
                stageFull: 'Stage is full — this hand stays #{position} in the queue. Take a floor first.',
                livekitFailure: '{message}. The durable grant was revoked; press Reconcile to retry the LiveKit update.',
                stageSummary: 'Stage: {active}/{max} publishing',
                slotsReserved: '{granted}/{max} slots reserved',
                handsRaised: '{count} hands raised',
                reconcile: 'Reconcile grants',
                handQueue: 'Hand queue',
                handQueueHelp: 'Raised hands appear automatically. Give floor invites a connected person; Remove hand clears the request. Snapshots are private, refresh together and disappear after {seconds}s without a new consented frame.',
                noHands: 'No hands raised.',
                waiting: 'waiting',
                connected: 'connected',
                disconnected: 'left',
                liveUnknown: 'live state unknown',
                quality: 'quality',
                reconcileNeeded: 'reconcile needed',
                giveFloor: 'Give floor',
                waitingForReconnect: 'Waiting for reconnect',
                removeHand: 'Remove hand',
                mustReconnect: 'Participant must be connected before joining the stage',
                invitedHeading: 'Invited / reconnecting',
                noInvitations: 'No pending stage invitations.',
                inviteAfterReentry: 'Disconnected — invitation will be shown again',
                unknownGrant: 'Live state unknown: the invitation remains active',
                awaitingAcceptance: 'Connected: waiting for acceptance and media',
                cancelInvitation: 'Cancel invitation',
                reservedFacilitator: 'Reserved facilitator slot',
                onStage: 'On stage',
                nobodyOnStage: 'Nobody has the floor yet.',
                noTracks: 'no tracks published',
                muted: 'muted',
                trackLive: 'live',
                participantMustEnable: 'Participant must re-enable {track}',
                muteTrack: 'Mute {track}',
                takeFloor: 'Take floor',
                audience: 'Audience ({count})',
                noAudience: 'No other participants.',
                inviteToStage: 'Invite to stage',
                recentSnapshotAlt: 'Recent tapestry snapshot of {name}',
                noSnapshotAlt: '{name}: no current tapestry snapshot',
                noImage: 'no image',
                footer: 'Signed in as {role}. Queue refreshes every {seconds}s; saved grants are authoritative.',
            },
            healthPanel: {
                pageTitle: 'Event health',
                pageIntro: 'Live subsystem board for the event. Red means launch-blocking; yellow means cuttable. Failure playbooks are in',
                headlines: {
                    green: 'GREEN — all subsystems nominal',
                    yellow: 'YELLOW — degraded, cuttable subsystem failing',
                    red: 'RED — launch-blocking subsystem failing',
                },
                levels: { green: 'green', yellow: 'yellow', red: 'red' },
                sessionStatuses: {
                    SCHEDULED: 'Upcoming',
                    LIVE: 'Live',
                    ENDED: 'Ended',
                    CANCELLED: 'Cancelled',
                },
                checks: {
                    postgres: 'PostgreSQL',
                    livekit: 'LiveKit API',
                    stageRoom: 'Stage room',
                    publisherGrants: 'Publisher grants',
                    bedPublisher: 'Bed publisher (playlist bot)',
                    tapestry: 'Tapestry (cuttable)',
                },
                endpointHttp: 'Endpoint answered HTTP {status}',
                endpointUnavailable: 'Health endpoint unreachable',
                endpointAlarm: 'RED — health endpoint unreachable: {error}',
                checking: 'Checking subsystems…',
                noReport: 'YELLOW — no report yet',
                watchingSession: 'Watching session',
                signedInAs: 'signed in as',
                noSession: 'No live or scheduled session is being watched',
                lastChecked: 'Last checked',
                refreshesEvery: 'refreshes every {seconds}s',
                waitingFirstReport: 'Waiting for the first report…',
                refreshNow: 'Refresh now',
            },
            admissionPanel: {
                pageTitle: 'Admission support',
                pageIntro: 'Signed in as {name} ({role}). Every mutation requires a non-PII reason and is audited.',
                unexpectedError: 'Unexpected error',
                notices: {
                    noMatches: 'No matching entitlements.',
                    accessRevoked: 'Access suspended or revoked.',
                    suspensionCleared: 'Administrative suspension cleared.',
                    bindingUpdated: 'Binding updated.',
                    batchGenerated: 'Batch generated. Copy or download the CSV now — it is shown only once.',
                    importComplete: 'Import complete: {created} created, {skipped} skipped (already existed).',
                    compIssued: 'Comp/override issued. Copy or download the CSV now — it is shown only once.',
                    invitationReady: 'Invitation created and ready to redeem.',
                    invitationSwitchOff: 'Invitation created, but the global redemption switch remains OFF.',
                    invitationCleanupFailed: 'Invitation disabled and access revoked; some live connections need a retry.',
                    invitationDisabled: 'Invitation disabled. {count} derived access grant(s) revoked.',
                },
                lookup: {
                    heading: 'Ticket lookup',
                    placeholder: 'Attendee email, code last four, or entitlement ID',
                    action: 'Look up',
                },
                labels: {
                    state: 'State:',
                    tier: 'Tier:',
                    lastFour: 'Last four:',
                    boundEmail: 'Bound email:',
                    event: 'Event:',
                    expires: 'Expires:',
                    commerce: 'Commerce:',
                    admin: 'admin',
                    media: 'media',
                    invitation: 'Invitation:',
                    campaign: 'campaign',
                    redeemed: 'redeemed',
                    revoked: 'Revoked',
                    cap: 'cap',
                },
                actions: {
                    reason: 'Reason (required, no PII)',
                    newEmail: 'New email (optional rebind)',
                    rebind: 'Rebind to email',
                    clearBinding: 'Clear binding',
                    resume: 'Resume access',
                    suspend: 'Suspend access',
                    revoke: 'Revoke',
                },
                tickets: {
                    heading: 'Issue tickets',
                    eventLabel: 'Event',
                    batchHeading: 'Batch (ADMIN)',
                    tierLabel: 'Ticket tier',
                    globalNorth: 'Global North ($50)',
                    globalSouth: 'Global South ($20)',
                    generate: 'Generate batch',
                    importPlaceholder: 'Paste platform CSV to import (code column, header optional)',
                    importAction: 'Import CSV (idempotent)',
                    overrideHeading: 'Comp / support override',
                    overrideTier: 'Override tier',
                    comp: 'Comp',
                    supportOverride: 'Support override',
                    overrideReason: 'Reason (required, no PII — e.g. support case reference)',
                    issue: 'Issue',
                },
                invitations: {
                    heading: 'Controlled invitations',
                    help: 'A short code creates the same session-scoped COMP entitlement as normal admission. Codes are stored only as digests; capacity, expiry and revocation remain enforced.',
                    load: 'Load invitations',
                    refresh: 'Refresh',
                    redemptionStatus: 'Public redemption is {status}.',
                    on: 'ON',
                    off: 'OFF',
                    createHeading: 'Create bounded invitation',
                    internalLabel: 'Internal label (never the code)',
                    internalPlaceholder: 'Guest list — morning ES',
                    humanCode: 'Human code (6–15 characters)',
                    expiresWithin: 'Expires (within seven days)',
                    capacity: 'Redemption capacity',
                    create: 'Create invitation',
                    none: 'No invitations created.',
                    redeemedCount: '{count}/{max} redeemed',
                    expires: 'expires',
                    disableReason: 'Disable reason (required, no PII)',
                    revokeDerived: 'Also revoke every entitlement already redeemed and disconnect its live media.',
                    disable: 'Disable invitation',
                    retryDisconnect: 'Retry revoke / disconnect',
                },
                export: {
                    heading: 'One-time code export',
                    warning: 'These plaintext codes are shown once and are never stored by the app. Save the CSV under ops control now; do not commit it or paste it into tickets/chat.',
                    download: 'Download CSV',
                },
                values: {
                    ISSUED: 'Issued',
                    BOUND: 'Bound',
                    REVOKED: 'Revoked',
                    EXPIRED: 'Expired',
                    ACTIVE: 'Active',
                    DISABLED: 'Disabled',
                    CLEAR: 'Clear',
                    SUSPENDED: 'Suspended',
                    NOT_REQUIRED: 'Not required',
                    RECONCILIATION_REQUIRED: 'Reconciliation required',
                    DISCONNECTED: 'Disconnected',
                },
                tiers: {
                    GLOBAL_NORTH: 'Global North',
                    GLOBAL_SOUTH: 'Global South',
                    COMP: 'Comp',
                    SUPPORT_OVERRIDE: 'Support override',
                },
            },
            tapestryArrange: {
                heading: 'Tapestry arrangement',
                saving: 'Saving…',
                save: 'Save arrangement',
                saved: 'Saved',
                saveFailed: 'Could not save the arrangement — try again',
                empty: 'No attendee snapshots yet — tiles appear here as cameras join.',
                tileAlt: 'Tapestry tile {index}',
                moveLeft: 'Move tile {index} left',
                moveRight: 'Move tile {index} right',
            },
            cockpit: {
                roomTitle: 'Live room',
                roomHint: 'The scene stays connected while you open tools.',
                door: 'Door',
                hands: 'Hands',
                stage: 'People on stage',
                primary: 'Next action',
                healthSignal: 'Health',
                open: 'Open',
                closed: 'Closed',
                next: 'Next',
                noHands: 'No hands',
                manageHands: 'Handle the next hand',
                inspectStage: 'Review the stage',
                reconcileStage: 'Reconcile the stage',
                inspectStageConnection: 'Check the stage connection',
                inspectHealth: 'Review system health',
                openDoors: 'Open doors',
                doorsPanel: 'Event doors',
                handsPanel: 'Hands, stage, and audience',
                tapestryPanel: 'Tapestry composition',
                admissionPanel: 'Admission support',
                healthPanel: 'System health',
                closePanel: 'Close tool',
                returnToRoom: 'Return to the live room',
                tools: 'Tools',
            },
        },
    },
};

export function staffRoleLabel(copy: Messages, role: LocalizedStaffRole): string {
    return copy.staffRoles[role];
}
