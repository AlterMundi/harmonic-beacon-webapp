'use client';

import { useState } from 'react';
import { useLocale } from '@/context/LocaleContext';

export default function ShareEventButton({ sessionId, title }: { sessionId: string; title: string }) {
    const { locale } = useLocale();
    const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
    const [busy, setBusy] = useState(false);
    const [link, setLink] = useState('');
    const es = locale === 'es';
    async function share() {
        if (busy) return;
        setBusy(true);
        setStatus('idle');
        const url = new URL(`/session/${encodeURIComponent(sessionId)}`, window.location.origin).href;
        setLink(url);
        try {
            if (navigator.share) await navigator.share({ title, url });
            else { await navigator.clipboard.writeText(url); setStatus('copied'); }
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('manual');
        } finally { setBusy(false); }
    }
    return <div className="hb-share-event">
        <button type="button" className="event-button event-button--secondary" onClick={() => void share()} disabled={busy}>
            {status === 'copied' ? (es ? 'Enlace copiado' : 'Link copied') : (es ? 'Compartir enlace' : 'Share link')}
        </button>
        <span className="sr-only" role="status">{status === 'copied' ? (es ? 'Enlace copiado' : 'Link copied') : ''}</span>
        {status === 'manual' && <label className="hb-share-event__fallback">
            {es ? 'Copiá este enlace' : 'Copy this link'}
            <input readOnly value={link} onFocus={event => event.currentTarget.select()} />
        </label>}
    </div>;
}
