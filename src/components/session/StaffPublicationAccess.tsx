'use client';

import { useState } from 'react';
import { useLocale } from '@/context/LocaleContext';

/** Existing subscribe-only staff opt in through the same audited stage grant
 * path. Rendering controls or refreshing a token never reverses a revocation. */
export default function StaffPublicationAccess({ sessionId }: { sessionId: string }) {
    const { locale } = useLocale();
    const es = locale === 'es';
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    async function activate() {
        setBusy(true); setNotice(null);
        try {
            const response = await fetch(`/api/ops/sessions/${encodeURIComponent(sessionId)}/stage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'self_publish' }),
            });
            if (!response.ok) throw new Error('Grant unavailable');
            setNotice(es ? 'Permiso solicitado. Los controles aparecerán al actualizarse la conexión.' : 'Permission requested. Controls appear when the connection updates.');
        } catch {
            setNotice(es ? 'No pudimos habilitar tus controles. Revisá la capacidad y el estado de la escena en el panel del equipo.' : 'Controls could not be enabled. Check stage capacity and status in the staff panel.');
        } finally { setBusy(false); }
    }
    return <div className="hb-staff-publication-access">
        <button type="button" className="event-button event-button--primary" disabled={busy} onClick={() => void activate()}>
            {busy ? (es ? 'Habilitando…' : 'Enabling…') : (es ? 'Habilitar mi micrófono y cámara' : 'Enable my microphone and camera')}
        </button>
        {notice && <p role="status">{notice}</p>}
    </div>;
}
