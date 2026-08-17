import type { UiLocale } from '@/lib/i18n';
import type { ListenerMembershipPresentation } from './membership-presentation';

export const earlyBirdCopy = {
    es: {
        eyebrow: 'HARMONIC BEACON · LISTENER',
        title: 'Recuerda tu centro armónico.',
        intro: 'Un campo armónico continuo, compartido alrededor del mundo.',
        signInGoogle: 'Continuar con Google',
        signInApple: 'Continuar con Apple',
        signingIn: 'Abriendo acceso…',
        magicLinkDivider: 'o',
        magicLinkEmail: 'Correo electrónico',
        magicLinkPlaceholder: 'tu@correo.com',
        magicLinkSend: 'Recibir enlace por correo',
        magicLinkSending: 'Solicitando enlace…',
        magicLinkSent: 'Si el correo puede usarse para este acceso, recibirás un enlace en unos minutos. Caduca a los diez minutos.',
        providerSoon: 'Configuración pendiente',
        signedIn: 'Tu cuenta Listener está lista.',
        signOut: 'Cerrar sesión',
        enter: 'Entrar al Beacon',
        redeem: 'Activar mi invitación',
        accessNeeded: 'Tu cuenta todavía no tiene acceso activo.',
        freeQuotaTitle: 'Tiempo Free semanal',
        freeQuotaNotStarted: 'Tu tiempo empieza cuando escuchas.',
        freeQuotaRemaining: 'Te quedan {time} esta semana',
        freeQuotaAvailable: 'Disponible para escuchar.',
        freeQuotaListening: 'El tiempo se actualiza mientras escuchas.',
        freeQuotaExhausted: 'Usaste tu tiempo Free de esta semana.',
        freeQuotaRenews: 'Volverá a estar disponible al renovarse tu ciclo.',
        freeQuotaResetsIn: 'Se renueva en {time}',
        freeQuotaExtra: 'Incluye {time} de crédito extra.',
        freeQuotaMembershipCta: 'Hazte miembro para tener acceso completo',
        checkoutSandboxTitle: 'Probar membresía Founder',
        checkoutSandboxDetail: 'Checkout de prueba. No usa dinero real.',
        checkoutLiveTitle: 'Founding Listener',
        checkoutLiveDetail: 'USD 5 por mes, cobro recurrente. Sin período de prueba. Puedes cancelar cuando quieras; si el servicio se interrumpe, termina el precio Founder.',
        checkoutPayPal: 'Continuar con PayPal',
        checkoutMercadoPago: 'Continuar con Mercado Pago',
        checkoutOpening: 'Abriendo checkout…',
        checkoutUnavailable: 'El checkout de prueba no está disponible ahora.',
        checkoutLiveUnavailable: 'La membresía no está disponible para compra en este momento.',
        checkoutAgreement: 'Al continuar aceptas las condiciones del servicio y el tratamiento de datos descrito aquí.',
        checkoutTerms: 'Condiciones',
        checkoutPrivacy: 'Privacidad',
        freeQuotaFounder: 'Acceso Founder',
        freeQuotaFreeForAll: 'Acceso libre',
        freeQuotaUnlimited: 'Puedes escuchar sin límite de tiempo.',
        authError: 'No pudimos completar el acceso. Usa el mismo proveedor con el que creaste tu cuenta o contacta a soporte.',
        serviceUnavailableTitle: 'No podemos confirmar tu acceso ahora.',
        identityUnavailable: 'El servicio de identidad no está respondiendo. Tus datos y tu acceso no cambiaron.',
        accessUnavailable: 'No pudimos consultar tu acceso o membresía. No mostraremos un estado estimado.',
        retryAccess: 'Intentar nuevamente',
        membershipInvitation: 'Acceso por invitación',
        membershipPreview: 'Acceso de prueba',
        membershipFounderActive: 'Founding Listener · USD 5/mes',
        membershipFounderGrace: 'Founding Listener · USD 5/mes · período de gracia',
        membershipFounderEnding: 'Founding Listener · USD 5/mes · activo hasta fin del período',
        membershipCurrentPeriodThrough: 'Período actual hasta {date}.',
        membershipAccessThrough: 'Acceso Founder hasta {date}.',
        membershipCancel: 'Cancelar membresía',
        membershipCancelConfirmTitle: 'Confirmar cancelación',
        membershipCancelConfirmDetail: 'Se detendrán los próximos cobros. No se reembolsa el período actual: conservarás acceso hasta que termine. Después perderás el precio Founder.',
        membershipCancelConfirm: 'Sí, cancelar al fin del período',
        membershipCancelWorking: 'Solicitando cancelación…',
        membershipKeep: 'Conservar membresía',
        membershipCancelQueued: 'Recibimos la solicitud. El estado se actualizará cuando el proveedor la confirme.',
        membershipCancelFailed: 'No pudimos solicitar la cancelación. Tu membresía no cambió.',
        membershipReactivate: 'Reactivar membresía',
        membershipReactivateWorking: 'Solicitando reactivación…',
        membershipReactivateQueued: 'Recibimos la solicitud. Tu membresía se actualizará cuando el proveedor confirme la reactivación.',
        membershipReactivateFailed: 'No pudimos solicitar la reactivación. Tu membresía no cambió.',
        membershipFounderPending: 'La membresía Founder todavía no está confirmada.',
        membershipFounderExpired: 'La membresía Founder finalizó.',
        membershipFounderRefunded: 'El pago fue reembolsado y el acceso Founder finalizó.',
        membershipFounderRevoked: 'El acceso Founder fue cerrado.',
        membershipFreeFallback: 'Puedes continuar con la escucha Free disponible para tu cuenta.',
        membershipInvitationEnded: 'La invitación ya no habilita el acceso.',
        membershipPreviewEnded: 'El acceso de prueba finalizó.',
    },
    en: {
        eyebrow: 'HARMONIC BEACON · LISTENER',
        title: 'Remember your harmonic center.',
        intro: 'A continuous harmonic field, shared across the world.',
        signInGoogle: 'Continue with Google',
        signInApple: 'Continue with Apple',
        signingIn: 'Opening access…',
        magicLinkDivider: 'or',
        magicLinkEmail: 'Email address',
        magicLinkPlaceholder: 'you@example.com',
        magicLinkSend: 'Email me a sign-in link',
        magicLinkSending: 'Requesting link…',
        magicLinkSent: 'If this email can be used for access, a link will arrive within a few minutes. It expires after ten minutes.',
        providerSoon: 'Configuration pending',
        signedIn: 'Your Listener account is ready.',
        signOut: 'Sign out',
        enter: 'Enter the Beacon',
        redeem: 'Activate my invitation',
        accessNeeded: 'Your account does not have active access yet.',
        freeQuotaTitle: 'Weekly Free time',
        freeQuotaNotStarted: 'Your time starts when you listen.',
        freeQuotaRemaining: 'You have {time} left this week',
        freeQuotaAvailable: 'Ready when you are.',
        freeQuotaListening: 'Your time updates while you listen.',
        freeQuotaExhausted: 'You have used your Free time for this week.',
        freeQuotaRenews: 'It will be available again when your cycle renews.',
        freeQuotaResetsIn: 'Renews in {time}',
        freeQuotaExtra: 'Includes {time} of extra credit.',
        freeQuotaMembershipCta: 'Become a member for full access',
        checkoutSandboxTitle: 'Try Founder membership',
        checkoutSandboxDetail: 'Test checkout. No real money is used.',
        checkoutLiveTitle: 'Founding Listener',
        checkoutLiveDetail: 'USD 5 per month, billed recurrently. No trial. Cancel anytime; if service lapses, Founder pricing ends.',
        checkoutPayPal: 'Continue with PayPal',
        checkoutMercadoPago: 'Continue with Mercado Pago',
        checkoutOpening: 'Opening checkout…',
        checkoutUnavailable: 'Test checkout is unavailable right now.',
        checkoutLiveUnavailable: 'Membership is not available for purchase right now.',
        checkoutAgreement: 'By continuing, you accept the service terms and the data practices described here.',
        checkoutTerms: 'Terms',
        checkoutPrivacy: 'Privacy',
        freeQuotaFounder: 'Founder access',
        freeQuotaFreeForAll: 'Open access',
        freeQuotaUnlimited: 'You can listen without a time limit.',
        authError: 'We could not complete sign-in. Use the provider that created your account, or contact support.',
        serviceUnavailableTitle: 'We cannot confirm your access right now.',
        identityUnavailable: 'The identity service is not responding. Your data and access have not changed.',
        accessUnavailable: 'We could not check your access or membership. We will not show an estimated state.',
        retryAccess: 'Try again',
        membershipInvitation: 'Invitation access',
        membershipPreview: 'Preview access',
        membershipFounderActive: 'Founding Listener · USD 5/month',
        membershipFounderGrace: 'Founding Listener · USD 5/month · grace period',
        membershipFounderEnding: 'Founding Listener · USD 5/month · active through period end',
        membershipCurrentPeriodThrough: 'Current period through {date}.',
        membershipAccessThrough: 'Founder access through {date}.',
        membershipCancel: 'Cancel membership',
        membershipCancelConfirmTitle: 'Confirm cancellation',
        membershipCancelConfirmDetail: 'Future charges will stop. The current period is not refunded: you will keep access until it ends. After that, Founder pricing ends.',
        membershipCancelConfirm: 'Yes, cancel at period end',
        membershipCancelWorking: 'Requesting cancellation…',
        membershipKeep: 'Keep membership',
        membershipCancelQueued: 'We received the request. Status will update after the provider confirms it.',
        membershipCancelFailed: 'We could not request cancellation. Your membership did not change.',
        membershipReactivate: 'Reactivate membership',
        membershipReactivateWorking: 'Requesting reactivation…',
        membershipReactivateQueued: 'We received the request. Your membership will update after the provider confirms reactivation.',
        membershipReactivateFailed: 'We could not request reactivation. Your membership did not change.',
        membershipFounderPending: 'Founder membership is not confirmed yet.',
        membershipFounderExpired: 'Founder membership has ended.',
        membershipFounderRefunded: 'The payment was refunded and Founder access has ended.',
        membershipFounderRevoked: 'Founder access was closed.',
        membershipFreeFallback: 'You can continue with the Free listening available to your account.',
        membershipInvitationEnded: 'The invitation no longer provides access.',
        membershipPreviewEnded: 'Preview access has ended.',
    },
} satisfies Record<UiLocale, Record<string, string>>;

export const earlyBirdLegalCopy = {
    es: {
        back: 'Volver a Listener',
        eyebrow: 'HARMONIC BEACON · FOUNDING LISTENER',
        title: 'Condiciones y privacidad del servicio Listener',
        updated: 'Versión de lanzamiento · 16 de agosto de 2026',
        sections: [
            {
                title: 'Oferta',
                paragraphs: [
                    'El vendedor inicial y merchant of record es Nicolás Echaniz, operando Harmonic Beacon desde Argentina. PayPal o Mercado Pago muestran el descriptor aplicable antes de confirmar. Para soporte de facturación o solicitar el comprobante fiscal aplicable escribe a nicoechaniz@harmonicbeacon.com.',
                    'Founding Listener cuesta USD 5 por mes, con cobro recurrente y sin período de prueba. Mercado Pago puede cobrar el equivalente en ARS informado por el checkout. El acceso se activa únicamente después de la confirmación canónica del proveedor.',
                    'El precio Founder se conserva mientras el servicio permanezca ininterrumpido, incluyendo el período ya pagado o de gracia aprobado. Cuando el servicio termina, también terminan la categoría y el precio Founder.',
                ],
            },
            {
                title: 'Cancelación, fallos y reembolsos',
                paragraphs: [
                    'Puedes cancelar desde tu perfil. La cancelación detiene cobros futuros, no reembolsa el período actual y conservas acceso hasta que termine ese período ya pagado. Una nueva alta posterior usa la oferta pública vigente.',
                    'Los reembolsos no forman parte de la cancelación normal ni son automáticos. Si un caso legal o de soporte excepcional requiere uno, se procesa manualmente con el proveedor; su confirmación, un contracargo, una disputa, fraude o terminación administrativa puede finalizar inmediatamente el acceso. Para pedir ayuda o revisar un cobro escribe a nicoechaniz@harmonicbeacon.com. La política legal aplicable y los derechos irrenunciables del consumidor prevalecen.',
                ],
            },
            {
                title: 'Servicio',
                paragraphs: [
                    'Harmonic Beacon ofrece un stream de audio continuo sujeto a mantenimiento, capacidad y disponibilidad de Internet. No garantizamos disponibilidad ininterrumpida y el servicio no sustituye atención médica, psicológica ni de emergencia.',
                    'El uso debe ser lícito y no debe intentar eludir límites de cuenta, interferir con el servicio o acceder a datos de otras personas.',
                ],
            },
            {
                title: 'Datos y privacidad',
                paragraphs: [
                    'Guardamos un identificador opaco de cuenta, identidad de acceso, sesión, estado de membresía, cuota y leases de reproducción. Los proveedores de pago procesan los datos financieros; Harmonic Beacon no recibe ni almacena números completos de tarjeta.',
                    'Conservamos evidencia de pago y eventos de membresía necesaria para seguridad, soporte, contabilidad e idempotencia. No enviamos información personal a la visualización pública ni vendemos datos personales. Puedes solicitar acceso, corrección o eliminación escribiendo a nicoechaniz@harmonicbeacon.com, sujeto a obligaciones legales de conservación.',
                ],
            },
        ],
    },
    en: {
        back: 'Back to Listener',
        eyebrow: 'HARMONIC BEACON · FOUNDING LISTENER',
        title: 'Listener service terms and privacy',
        updated: 'Launch version · August 16, 2026',
        sections: [
            {
                title: 'Offer',
                paragraphs: [
                    'The initial seller and merchant of record is Nicolás Echaniz, operating Harmonic Beacon from Argentina. PayPal or Mercado Pago shows the applicable descriptor before confirmation. For billing support or to request the applicable tax receipt, contact nicoechaniz@harmonicbeacon.com.',
                    'Founding Listener costs USD 5 per month, billed recurrently with no trial. Mercado Pago may charge the ARS equivalent shown at checkout. Access starts only after canonical provider confirmation.',
                    'Founder pricing continues while service remains uninterrupted, including an already-paid period or approved grace. When service ends, Founder status and pricing end as well.',
                ],
            },
            {
                title: 'Cancellation, failures and refunds',
                paragraphs: [
                    'You can cancel from your profile. Cancellation stops future charges, does not refund the current period, and access continues until that already-paid period ends. A later signup uses the public offer available then.',
                    'Refunds are not part of normal cancellation and are never automatic. If an exceptional legal or support case requires one, it is processed manually with the provider; its confirmation, a chargeback, dispute, fraud finding or administrative termination may end access immediately. For billing help or review, contact nicoechaniz@harmonicbeacon.com. Applicable law and non-waivable consumer rights prevail.',
                ],
            },
            {
                title: 'Service',
                paragraphs: [
                    'Harmonic Beacon provides a continuous audio stream subject to maintenance, capacity and Internet availability. We do not guarantee uninterrupted availability, and the service is not a substitute for medical, psychological or emergency care.',
                    'Use must be lawful and must not attempt to evade account limits, interfere with the service or access another person’s data.',
                ],
            },
            {
                title: 'Data and privacy',
                paragraphs: [
                    'We keep an opaque account identifier, sign-in identity, session, membership state, allowance and playback leases. Payment providers process financial details; Harmonic Beacon does not receive or store full card numbers.',
                    'We retain payment evidence and membership events needed for security, support, accounting and idempotency. We do not send personal data to the public visualization or sell personal data. You may request access, correction or deletion at nicoechaniz@harmonicbeacon.com, subject to legal retention duties.',
                ],
            },
        ],
    },
} satisfies Record<UiLocale, {
    back: string;
    eyebrow: string;
    title: string;
    updated: string;
    sections: Array<{ title: string; paragraphs: string[] }>;
}>;

export const earlyBirdSyntheticEntryCopy = {
    es: {
        title: 'Acceso de equipo · staging',
        description: 'Sólo para pruebas acordadas. Usa una cuenta sintética @e2e.invalid y el código temporal del equipo.',
        name: 'Nombre de prueba',
        email: 'Cuenta sintética',
        accessCode: 'Código de acceso temporal',
        enter: 'Entrar a staging',
        entering: 'Abriendo staging…',
        failed: 'El acceso de prueba no está disponible o los datos no son válidos.',
    },
    en: {
        title: 'Team access · staging',
        description: 'For agreed testing only. Use a synthetic @e2e.invalid account and the team’s temporary access code.',
        name: 'Test name',
        email: 'Synthetic account',
        accessCode: 'Temporary access code',
        enter: 'Enter staging',
        entering: 'Opening staging…',
        failed: 'Test access is unavailable or the supplied details are invalid.',
    },
} satisfies Record<UiLocale, Record<string, string>>;

export const earlyBirdHomeCopy = {
    es: {
        eyebrow: 'HARMONIC BEACON · LISTENER',
        heading: 'Beacon',
        listen: 'Escuchar',
        playIntroFirst: 'Reproducir introducción primero',
        skipToBeacon: 'Saltar al Beacon',
        seek: 'Posición',
        prepareDevice: 'Habilitar este dispositivo',
        deviceReady: 'Dispositivo listo. Toca otra vez para escuchar o elige una introducción.',
        deviceLimitClaim: 'Ya hay dos dispositivos activos. Habilitar éste detendrá la escucha en el menos reciente.',
        prepareHelp: 'No pudimos preparar el stream automáticamente. Habilita este dispositivo antes de escuchar.',
        pause: 'Pausar',
        resume: 'Continuar',
        paused: 'Pausado',
        loading: 'Conectando…',
        reconnecting: 'Restableciendo conexión…',
        unavailable: 'El Beacon no está disponible en este momento.',
        displaced: 'Este dispositivo fue desplazado porque la cuenta ya está escuchando en otros dos dispositivos.',
        spanish: 'Introducción · Español',
        english: 'Introducción · Inglés',
        dropUnavailable: 'El render aprobado todavía no fue publicado.',
        introSelection: 'Idioma de la introducción',
        stop: 'Detener',
        playingIntro: 'Sonando intro · después sigue el Beacon',
        playingBeacon: 'Beacon activo',
        stopped: 'Detenido',
        master: 'Volumen',
        signOut: 'Cerrar sesión',
        active: 'Listener activo',
        account: 'Cuenta',
    },
    en: {
        eyebrow: 'HARMONIC BEACON · LISTENER',
        heading: 'Beacon',
        listen: 'Listen',
        playIntroFirst: 'Play introduction first',
        skipToBeacon: 'Skip to the Beacon',
        seek: 'Seek',
        prepareDevice: 'Enable this device',
        deviceReady: 'Device ready. Tap again to listen, or choose a drop-in.',
        deviceLimitClaim: 'Two devices are already active. Enabling this one will stop playback on the least recent device.',
        prepareHelp: 'We could not prepare the stream automatically. Enable this device before listening.',
        pause: 'Pause',
        resume: 'Resume',
        paused: 'Paused',
        loading: 'Connecting…',
        reconnecting: 'Restoring connection…',
        unavailable: 'The Beacon is unavailable right now.',
        displaced: 'This device was displaced because the account is already listening on two other devices.',
        spanish: 'Warm-up · Spanish',
        english: 'Warm-up · English',
        dropUnavailable: 'The approved render has not been published yet.',
        introSelection: 'Introduction language',
        stop: 'Stop',
        playingIntro: 'Playing intro · Beacon follows',
        playingBeacon: 'Beacon playing',
        stopped: 'Stopped',
        master: 'Volume',
        signOut: 'Sign out',
        active: 'Listener active',
        account: 'Account',
    },
} satisfies Record<UiLocale, Record<string, string>>;

type MembershipCopy = { [Key in keyof typeof earlyBirdCopy.en]: string };

export function listenerMembershipPresentationCopy(
    copy: MembershipCopy,
    presentation: ListenerMembershipPresentation,
): { title: string; detail: string | null } | null {
    if (presentation.kind === 'none') return null;

    if (presentation.kind === 'invitation') {
        return {
            title: copy.membershipInvitation,
            detail: presentation.state === 'active' ? null : copy.membershipInvitationEnded,
        };
    }
    if (presentation.kind === 'preview') {
        return {
            title: copy.membershipPreview,
            detail: presentation.state === 'active' ? null : copy.membershipPreviewEnded,
        };
    }

    const provider = presentation.provider === 'paypal' ? 'PayPal' : 'Mercado Pago';
    switch (presentation.state) {
        case 'active': return { title: copy.membershipFounderActive, detail: provider };
        case 'grace': return { title: copy.membershipFounderGrace, detail: provider };
        case 'ending': return { title: copy.membershipFounderEnding, detail: provider };
        case 'pending': return { title: copy.membershipFounderPending, detail: copy.membershipFreeFallback };
        case 'expired': return { title: copy.membershipFounderExpired, detail: copy.membershipFreeFallback };
        case 'refunded': return { title: copy.membershipFounderRefunded, detail: copy.membershipFreeFallback };
        case 'revoked': return { title: copy.membershipFounderRevoked, detail: copy.membershipFreeFallback };
    }
}
