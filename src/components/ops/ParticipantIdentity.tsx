'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';

type Profile = { preferredName: string | null; realName: string | null; email: string | null; emailVerified: boolean | null };
type IdentityResponse = { alias: string | null; identity: { profile: Profile | null } | null };

/** Mounted only for Admin; the endpoint independently checks the same role. */
export default function ParticipantIdentity({ sessionId, participantId }: { sessionId: string; participantId: string }) {
    const { locale } = useLocale();
    const es = locale === 'es';
    const [open, setOpen] = useState(false);
    const [result, setResult] = useState<IdentityResponse | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        void fetch(`/api/ops/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}/identity`, {
            cache: 'no-store', signal: controller.signal,
        }).then(async (response) => {
            if (!response.ok) throw new Error('unavailable');
            const body = await response.json() as IdentityResponse;
            if (!controller.signal.aborted) setResult(body);
        }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
        return () => controller.abort();
    }, [open, sessionId, participantId]);
    const profile = result?.identity?.profile;
    const unknown = es ? 'Sin datos' : 'Unknown';
    return <details className="text-sm" onToggle={(event) => {
        if (event.currentTarget.open === open) return;
        setResult(null);
        setFailed(false);
        setOpen(event.currentTarget.open);
    }}>
        <summary className="cursor-pointer py-2">{es ? 'Identidad' : 'Identity'}</summary>
        {open && <div className="rounded border border-[var(--border-subtle)] p-3">
            {failed ? <p role="alert">{es ? 'No se pudo consultar la cuenta.' : 'Account lookup unavailable.'}</p>
                : !result ? <p role="status">{es ? 'Cargando…' : 'Loading…'}</p>
                    : <dl className="space-y-1">
                        <dt>{es ? 'Alias del evento' : 'Event alias'}</dt><dd>{result.alias || unknown}</dd>
                        <dt>{es ? 'Nombre preferido' : 'Preferred name'}</dt><dd>{profile?.preferredName || unknown}</dd>
                        <dt>{es ? 'Nombre real (privado)' : 'Real name (private)'}</dt><dd>{profile?.realName || unknown}</dd>
                        <dt>Email</dt><dd>{profile?.email || unknown}{profile?.email && profile.emailVerified !== true
                            ? (es ? ' · No verificado' : ' · Not verified') : ''}</dd>
                    </dl>}
        </div>}
    </details>;
}
