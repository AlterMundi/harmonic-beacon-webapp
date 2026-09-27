import { NextRequest, NextResponse } from 'next/server';
import { resolveUiLocale, UI_LOCALE_COOKIE } from '@/lib/i18n';

type EntryFailure = 'event_unavailable' | 'account_unavailable' | 'invalid_origin' | 'entry_not_attached';
const COPY = {
    es: {
        title: 'No pudimos completar el ingreso',
        events: 'Volver a los eventos',
        retry: 'Volver a iniciar sesión',
        event_unavailable: 'Este evento no está disponible para ingreso público. Revisá la lista de eventos o consultá al equipo organizador.',
        account_unavailable: 'El acceso con Beacon Account no está disponible en este momento. Volvé a intentarlo más tarde.',
        invalid_origin: 'Este enlace de ingreso no corresponde a una dirección habilitada de Live. Volvé a la portada.',
        entry_not_attached: 'No pudimos habilitar el ingreso con tu sesión de cuenta actual. Volvé a iniciar sesión y seleccioná el evento. Si persiste, consultá al equipo organizador.',
    },
    en: {
        title: 'We could not complete your entry',
        events: 'Back to events',
        retry: 'Sign in again',
        event_unavailable: 'This event is not available for public entry. Check the event list or contact the organizers.',
        account_unavailable: 'Beacon Account access is unavailable right now. Please try again later.',
        invalid_origin: 'This entry link does not use an enabled Live address. Return to the home page.',
        entry_not_attached: 'We could not enable entry with your current account session. Sign in again and select the event. If this continues, contact the organizers.',
    },
} as const;

/** Static failure copy only: no account identifiers, raw exceptions or untrusted URLs. */
export function publicEntryFailure(request: NextRequest, code: EntryFailure, status: number): NextResponse {
    const locale = resolveUiLocale(request.cookies.get(UI_LOCALE_COOKIE)?.value);
    const copy = COPY[locale];
    const actionHref = code === 'entry_not_attached' ? '/api/account/login?flow=attendee&next=%2F' : '/';
    const actionLabel = code === 'entry_not_attached' ? copy.retry : copy.events;
    const headers = { 'Cache-Control': 'private, no-store', Vary: 'Accept, Cookie' };
    if (!request.headers.get('accept')?.includes('text/html')) {
        return NextResponse.json({ error: copy[code], code, action: { href: actionHref, label: actionLabel } }, { status, headers });
    }
    // All interpolation comes from closed constants above, never request values.
    return new NextResponse(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.title} · Harmonic Beacon</title><style>body{margin:0;background:#10251f;color:#f7eedc;font:18px/1.6 system-ui}main{max-width:38rem;margin:12vh auto;padding:1.5rem}h1{font-size:1.8rem}a{color:#edcf8a;display:inline-block;padding:.75rem 0}small{opacity:.7}</style></head><body><main><small>Harmonic Beacon</small><h1>${copy.title}</h1><p>${copy[code]}</p><a href="${actionHref}">${actionLabel}</a></main></body></html>`, {
        status,
        headers: {
            ...headers,
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        },
    });
}
