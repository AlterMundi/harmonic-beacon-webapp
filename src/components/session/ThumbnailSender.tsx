'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Product decision (2026-07-31, Nico): the tapestry camera is ON BY DEFAULT
// for every attendee — each participant appears in the composite as a small
// jpeg refreshed at ~1 FPS. Explicit opt-out via the stop button.
const CAPTURE_INTERVAL_MS = 1_000;

type Props = { sessionId: string; connected: boolean; isPublishing: boolean };

export default function ThumbnailSender({ sessionId, connected, isPublishing }: Props) {
    const streamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sendingRef = useRef(false);
    // Set only by the explicit opt-out button; lifecycle stops (tab hidden,
    // disconnect, promotion to publisher) never opt the attendee out.
    const optedOutRef = useRef(false);
    const [enabled, setEnabled] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const stop = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setEnabled(false);
    }, []);

    const sendFrame = useCallback(async () => {
        const video = videoRef.current;
        if (!video || !streamRef.current || document.hidden || sendingRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(video, 0, 0, 100, 100);
        const frame = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.65));
        if (!frame || frame.size > 20 * 1024 || !streamRef.current || document.hidden) return;
        sendingRef.current = true;
        try {
            await fetch(`/api/tapestry/frame?sessionId=${encodeURIComponent(sessionId)}`, {
                method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: frame, cache: 'no-store',
            });
        } catch {
            // The tapestry is cuttable
        } finally {
            sendingRef.current = false;
        }
    }, [sessionId]);

    useEffect(() => {
        if (!enabled || !connected || isPublishing || document.hidden) return;
        let cancelled = false;
        const tick = async () => {
            await sendFrame();
            if (!cancelled) timerRef.current = setTimeout(tick, CAPTURE_INTERVAL_MS);
        };
        void tick();
        return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current); };
    }, [connected, enabled, isPublishing, sendFrame]);

    useEffect(() => {
        const onVisibility = () => { if (document.hidden) stop(); };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [stop]);

    useEffect(() => { if (isPublishing || !connected) stop(); }, [connected, isPublishing, stop]);
    useEffect(() => () => stop(), [stop]);

    const enable = useCallback(async () => {
        if (isPublishing) return;
        setMessage(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 320 }, audio: false });
            if (isPublishing || document.hidden) { stream.getTracks().forEach((track) => track.stop()); return; }
            streamRef.current = stream;
            if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
            setEnabled(true);
        } catch {
            setMessage('Camera permission was not granted. You can still take part in the session.');
        }
    }, [isPublishing]);

    // Default-on: as soon as the room is connected (and the attendee is not
    // a publisher), start the tapestry camera unless they opted out. A denied
    // permission leaves `enabled` false and shows the message without looping
    // (the effect deps stay stable until something real changes).
    useEffect(() => {
        if (connected && !isPublishing && !enabled && !optedOutRef.current) {
            void enable();
        }
    }, [connected, isPublishing, enabled, enable]);

    const optOut = useCallback(() => {
        optedOutRef.current = true;
        stop();
    }, [stop]);

    const optIn = useCallback(() => {
        optedOutRef.current = false;
        void enable();
    }, [enable]);

    if (isPublishing) return null;
    return <section className="w-full max-w-xs text-center" aria-live="polite">
        <video ref={videoRef} muted playsInline className="hidden" />
        {enabled ? <button type="button" className="text-xs text-[var(--text-muted)] underline" onClick={optOut}>Stop tapestry camera</button> :
            <button type="button" className="text-xs text-[var(--gold)] underline" onClick={optIn} disabled={!connected}>Share a camera snapshot</button>}
        {message ? <p className="mt-1 text-xs text-[var(--text-muted)]">{message}</p> : null}
    </section>;
}
