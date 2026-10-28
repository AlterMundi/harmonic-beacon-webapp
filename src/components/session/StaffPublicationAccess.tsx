'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';

/** Existing subscribe-only staff opt in through the same audited stage grant
 * path. Rendering controls or refreshing a token never reverses a revocation. */
export default function StaffPublicationAccess({ sessionId, canPublish, onGrantChange }: {
    sessionId: string; canPublish: boolean; onGrantChange: (canPublish: boolean, grantVersion: number) => void;
}) {
    const { locale } = useLocale();
    const es = locale === 'es';
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        async function refresh() {
            try {
                const response = await fetch(`/api/ops/sessions/${encodeURIComponent(sessionId)}/stage`, { cache: 'no-store', signal: controller.signal });
                if (response.status === 401 || response.status === 403) return;
                if (response.ok) {
                    const grant = await response.json();
                    if (!cancelled && typeof grant.canPublish === 'boolean' && Number.isSafeInteger(grant.grantVersion) && grant.grantVersion >= 0) {
                        onGrantChange(grant.canPublish, grant.grantVersion);
                    }
                }
            } catch { /* Keep the last confirmed snapshot; never acquire devices. */ }
            if (!cancelled) timer = setTimeout(() => void refresh(), 2_000);
        }
        void refresh();
        return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
    }, [sessionId, onGrantChange]);
    async function activate() {
        setBusy(true); setNotice(null);
        try {
            const response = await fetch(`/api/ops/sessions/${encodeURIComponent(sessionId)}/stage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'self_publish' }),
            });
            if (!response.ok) throw new Error('Grant unavailable');
            const grant = await response.json();
            if (typeof grant.canPublish !== 'boolean' || !Number.isSafeInteger(grant.grantVersion) || grant.grantVersion < 0) {
                throw new Error('Invalid grant snapshot');
            }
            // Pair the permission event with this exact version immediately.
            // A fast leave must not reuse the pre-activation poll's version.
            onGrantChange(grant.canPublish, grant.grantVersion);
            setNotice(null);
        } catch {
            setNotice(es ? 'No pudimos habilitar tus controles. Revisá la capacidad y el estado de la escena en el panel del equipo.' : 'Controls could not be enabled. Check stage capacity and status in the staff panel.');
        } finally { setBusy(false); }
    }
    if (canPublish) return null;
    return <div className="hb-staff-publication-access">
        <button type="button" className="event-button event-button--primary" disabled={busy} onClick={() => void activate()}>
            {busy ? (es ? 'Habilitando controles…' : 'Enabling controls…') : (es ? 'Habilitar mis controles de equipo' : 'Enable my staff controls')}
        </button>
        {notice && <p role="status">{notice}</p>}
    </div>;
}
