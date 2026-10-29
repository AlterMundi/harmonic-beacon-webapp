'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';
import { deviceCheckTone } from '@/lib/device-check-tone';

/** A pre-meeting local check. It never joins a room, records or uploads media. */
export default function DeviceCheck() {
    const { locale } = useLocale();
    const es = locale === 'es';
    const video = useRef<HTMLVideoElement>(null);
    const audio = useRef<HTMLAudioElement>(null);
    const meter = useRef<HTMLProgressElement>(null);
    const micStream = useRef<MediaStream | null>(null);
    const camStream = useRef<MediaStream | null>(null);
    const context = useRef<AudioContext | null>(null);
    const animation = useRef<number | null>(null);
    const generations = useRef({ mic: 0, cam: 0 });
    const permissionGranted = useRef(false);
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [mic, setMic] = useState('');
    const [cam, setCam] = useState('');
    const [sink, setSink] = useState('');
    const [micOn, setMicOn] = useState(false);
    const [camOn, setCamOn] = useState(false);
    const [busy, setBusy] = useState({ mic: false, cam: false, sink: false });
    const [playing, setPlaying] = useState(false);
    const [speakerChoice, setSpeakerChoice] = useState(false);
    const [available, setAvailable] = useState(true);
    const [error, setError] = useState<'mic' | 'cam' | 'sound' | 'sink' | null>(null);
    const [back, setBack] = useState('/profile');

    const refreshDevices = useCallback(async () => {
        if (!permissionGranted.current) return;
        try { setDevices(await navigator.mediaDevices.enumerateDevices()); } catch { /* Default devices remain usable. */ }
    }, []);
    const releaseMic = useCallback(() => {
        generations.current.mic += 1;
        micStream.current?.getTracks().forEach(track => track.stop());
        micStream.current = null;
        if (animation.current !== null) cancelAnimationFrame(animation.current);
        animation.current = null;
        if (meter.current) meter.current.value = 0;
        void context.current?.close().catch(() => {});
        context.current = null;
    }, []);
    const releaseCam = useCallback(() => {
        generations.current.cam += 1;
        camStream.current?.getTracks().forEach(track => track.stop());
        camStream.current = null;
        if (video.current) video.current.srcObject = null;
    }, []);
    const stopAll = useCallback(() => {
        releaseMic(); releaseCam();
        audio.current?.pause();
        setMicOn(false); setCamOn(false); setPlaying(false);
        setBusy({ mic: false, cam: false, sink: false });
    }, [releaseMic, releaseCam]);

    useEffect(() => {
        const testAudio = audio.current;
        const toneUrl = URL.createObjectURL(deviceCheckTone());
        if (testAudio) testAudio.src = toneUrl;
        setAvailable(Boolean(navigator.mediaDevices?.getUserMedia));
        setSpeakerChoice(Boolean(audio.current && 'setSinkId' in audio.current));
        const next = new URLSearchParams(window.location.search).get('next');
        if (next && /^\/(?:session|ops\/events)\/[a-f0-9-]{36}$/.test(next)) setBack(next);
        navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
        const hidden = () => { if (document.hidden) stopAll(); };
        document.addEventListener('visibilitychange', hidden);
        window.addEventListener('pagehide', stopAll);
        return () => {
            releaseMic(); releaseCam(); testAudio?.pause();
            URL.revokeObjectURL(toneUrl);
            navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
            document.removeEventListener('visibilitychange', hidden);
            window.removeEventListener('pagehide', stopAll);
        };
    }, [refreshDevices, releaseMic, releaseCam, stopAll]);

    async function startMic(deviceId = mic) {
        releaseMic(); setMicOn(false); setError(null); setBusy(value => ({ ...value, mic: true }));
        const generation = generations.current.mic;
        let stream: MediaStream | null = null;
        try {
            // Resume the private analyser context inside this explicit gesture.
            const analyserContext = new AudioContext();
            context.current = analyserContext;
            void analyserContext.resume().catch(() => {});
            stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false });
            if (generation !== generations.current.mic || document.hidden) { stream.getTracks().forEach(track => track.stop()); return; }
            micStream.current = stream;
            const analyser = analyserContext.createAnalyser();
            analyser.fftSize = 512;
            analyserContext.createMediaStreamSource(stream).connect(analyser);
            // Intentionally no connection to destination: no microphone echo.
            const values = new Uint8Array(analyser.fftSize);
            const readLevel = () => {
                if (generation !== generations.current.mic) return;
                analyser.getByteTimeDomainData(values);
                const rms = Math.sqrt(values.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / values.length);
                if (meter.current) meter.current.value = Math.min(1, rms * 5);
                animation.current = requestAnimationFrame(readLevel);
            };
            readLevel(); setMicOn(true); permissionGranted.current = true;
            stream.getAudioTracks()[0]?.addEventListener('ended', () => {
                if (generation !== generations.current.mic) return;
                releaseMic(); setMicOn(false); setError('mic');
            }, { once: true });
            void refreshDevices();
        } catch {
            stream?.getTracks().forEach(track => track.stop());
            if (generation === generations.current.mic) { releaseMic(); setMicOn(false); setBusy(value => ({ ...value, mic: false })); setError('mic'); }
        } finally {
            if (generation === generations.current.mic) setBusy(value => ({ ...value, mic: false }));
        }
    }
    async function startCam(deviceId = cam) {
        releaseCam(); setCamOn(false); setError(null); setBusy(value => ({ ...value, cam: true }));
        const generation = generations.current.cam;
        let stream: MediaStream | null = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false });
            if (generation !== generations.current.cam || document.hidden) { stream.getTracks().forEach(track => track.stop()); return; }
            camStream.current = stream;
            if (video.current) { video.current.srcObject = stream; await video.current.play(); }
            if (generation !== generations.current.cam) return;
            setCamOn(true); permissionGranted.current = true;
            stream.getVideoTracks()[0]?.addEventListener('ended', () => {
                if (generation !== generations.current.cam) return;
                releaseCam(); setCamOn(false); setError('cam');
            }, { once: true });
            void refreshDevices();
        } catch {
            stream?.getTracks().forEach(track => track.stop());
            if (generation === generations.current.cam) { releaseCam(); setCamOn(false); setBusy(value => ({ ...value, cam: false })); setError('cam'); }
        } finally {
            if (generation === generations.current.cam) setBusy(value => ({ ...value, cam: false }));
        }
    }
    const list = (kind: MediaDeviceKind) => devices.filter(device => device.kind === kind && device.deviceId);

    return <main className="event-shell"><div className="hb-device-check hb-profile">
        <header className="hb-profile-heading"><div>
            <p className="hb-profile-eyebrow">Beacon Live</p>
            <h1>{es ? 'Probá tus dispositivos' : 'Check your devices'}</h1>
            <p>{es ? 'Antes de entrar al encuentro. La prueba queda en este dispositivo: no grabamos ni enviamos tu cámara o micrófono.' : 'Before joining. This check stays on your device: your camera and microphone are never recorded or uploaded.'}</p>
        </div></header>
        {!available && <p role="alert">{es ? 'Tu navegador no permite probar dispositivos aquí. Abrí esta página con HTTPS en Safari o Chrome.' : 'Device testing is unavailable here. Open this page over HTTPS in Safari or Chrome.'}</p>}
        <div className="hb-device-check-grid">
            <section className="hb-profile-card" aria-labelledby="check-mic"><h2 id="check-mic">{es ? 'Micrófono' : 'Microphone'}</h2>
                <label htmlFor="check-mic-device">{es ? 'Entrada de audio' : 'Audio input'}</label>
                <select id="check-mic-device" value={mic} disabled={busy.mic} onChange={event => { setMic(event.target.value); if (micOn) void startMic(event.target.value); }}><option value="">{es ? 'Predeterminado' : 'Default'}</option>{list('audioinput').map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${es ? 'Micrófono' : 'Microphone'} ${i + 1}`}</option>)}</select>
                <progress ref={meter} max={1} value={0} aria-label={es ? 'Nivel del micrófono' : 'Microphone level'} />
                <p>{micOn ? (es ? 'Hablá: el indicador debería moverse.' : 'Speak: the level should move.') : (es ? 'Activá la prueba para ver el nivel de tu voz.' : 'Start the check to see your voice level.')}</p>
                <button className="event-button event-button--secondary" disabled={!available || busy.mic} onClick={() => { if (micOn) { releaseMic(); setMicOn(false); } else void startMic(); }}>{busy.mic ? (es ? 'Solicitando permiso…' : 'Requesting permission…') : micOn ? (es ? 'Detener micrófono' : 'Stop microphone') : (es ? 'Probar micrófono' : 'Test microphone')}</button>
            </section>
            <section className="hb-profile-card" aria-labelledby="check-camera"><h2 id="check-camera">{es ? 'Cámara' : 'Camera'}</h2>
                <label htmlFor="check-camera-device">{es ? 'Cámara de video' : 'Video camera'}</label>
                <select id="check-camera-device" value={cam} disabled={busy.cam} onChange={event => { setCam(event.target.value); if (camOn) void startCam(event.target.value); }}><option value="">{es ? 'Predeterminada' : 'Default'}</option>{list('videoinput').map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${es ? 'Cámara' : 'Camera'} ${i + 1}`}</option>)}</select>
                <video ref={video} autoPlay muted playsInline aria-label={es ? 'Vista previa local de cámara' : 'Local camera preview'} />
                <button className="event-button event-button--secondary" disabled={!available || busy.cam} onClick={() => { if (camOn) { releaseCam(); setCamOn(false); } else void startCam(); }}>{busy.cam ? (es ? 'Solicitando permiso…' : 'Requesting permission…') : camOn ? (es ? 'Detener cámara' : 'Stop camera') : (es ? 'Probar cámara' : 'Test camera')}</button>
            </section>
            <section className="hb-profile-card" aria-labelledby="check-sound"><h2 id="check-sound">{es ? 'Sonido' : 'Sound'}</h2>
                {speakerChoice ? <><label htmlFor="check-output">{es ? 'Salida de audio' : 'Audio output'}</label><select id="check-output" value={sink} disabled={busy.sink || playing} onChange={async event => {
                    const selected = event.target.value; setBusy(value => ({ ...value, sink: true })); setError(null);
                    try { await (audio.current as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(selected); setSink(selected); } catch { setError('sink'); }
                    finally { setBusy(value => ({ ...value, sink: false })); }
                }}><option value="">{es ? 'Predeterminada' : 'Default'}</option>{list('audiooutput').map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${es ? 'Salida' : 'Output'} ${i + 1}`}</option>)}</select></> : <p>{es ? 'Usamos la salida elegida en tu dispositivo. Podés cambiarla desde sus ajustes de sonido.' : 'Using your device’s selected output. Change it in the device sound settings.'}</p>}
                <audio ref={audio} preload="none" onEnded={() => setPlaying(false)} />
                <p>{es ? 'Reproducí un sonido breve y comprobá que lo escuchás por tus auriculares o parlantes.' : 'Play a short sound and check your headphones or speakers.'}</p>
                <button className="event-button event-button--secondary" disabled={busy.sink || playing} onClick={() => { setError(null); if (!audio.current) return; audio.current.currentTime = 0; setPlaying(true); void audio.current.play().catch(() => { setPlaying(false); setError('sound'); }); }}>{playing ? (es ? 'Reproduciendo…' : 'Playing…') : (es ? 'Reproducir sonido de prueba' : 'Play test sound')}</button>
            </section>
        </div>
        {error && <p role="alert" className="event-alert event-alert--warning">{error === 'mic' || error === 'cam'
            ? (es ? 'No pudimos acceder al dispositivo. Revisá el permiso del navegador, la conexión y si otra app lo está usando. Podés volver a probar.' : 'Could not access the device. Check browser permissions, the connection, and other apps using it. You can try again.')
            : (es ? 'No pudimos reproducir el sonido en esa salida. Revisá el volumen y los ajustes del dispositivo y volvé a probar.' : 'Could not play sound on that output. Check volume and device settings, then try again.')}</p>}
        <footer className="hb-device-check-actions"><button className="event-button event-button--secondary" onClick={stopAll}>{es ? 'Detener todas las pruebas' : 'Stop all checks'}</button><a href={back} className="event-button event-button--primary" onClick={stopAll}>{es ? 'Continuar a Beacon' : 'Continue to Beacon'}</a></footer>
    </div></main>;
}
