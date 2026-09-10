'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/context/LocaleContext';
import type { UiLocale } from '@/lib/i18n';
import { installHistoryFallback } from './history-fallback';

type ExitAction = () => void | boolean | Promise<void | boolean>;
const copy: Record<UiLocale, { heading: string; body: string; stay: string; leave: string }> = {
    en: { heading: 'Leave the room?', body: 'Leaving disconnects this page from the session and Beacon. Stay to keep listening.', stay: 'Stay in the room', leave: 'Leave the room' },
    es: { heading: '¿Salir de la sala?', body: 'Salir desconecta esta página de la sesión y del Beacon. Quedate para seguir escuchando.', stay: 'Quedarme en la sala', leave: 'Salir de la sala' },
};

function focusedElement(): HTMLElement | null {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active instanceof HTMLElement ? active : null;
}

class ExitCoordinator {
    private rooms = new Set<object>();
    private listeners = new Set<() => void>();
    private revision = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;
    departureRevision = 0;
    nativeUnloadInProgress = false;
    hosted = false;
    hostRegistration: { generation: string; host: string; document: Document } | null = null;
    requestViaHost: ((action: ExitAction) => void) | null = null;
    permitted = false;
    running = false;
    pending: { action: ExitAction; focus: HTMLElement | null; onCancel?: () => void } | null = null;
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    snapshot = () => this.revision;
    changed = () => { this.revision++; this.listeners.forEach(listener => listener()); };
    active = () => this.rooms.size > 0;
    setActive = (key: object, active: boolean) => {
        if (this.rooms.has(key) === active) return;
        if (active) this.rooms.add(key); else this.rooms.delete(key);
        // Terminal/revoked/unmounted rooms must never be held by a stale modal.
        if (!this.active()) { this.pending?.onCancel?.(); this.pending = null; this.permitted = false; }
        this.changed();
    };
    request = (action: ExitAction, onCancel?: () => void) => {
        if (this.pending || this.running) return;
        if (!this.active()) { void action(); return; }
        if (this.requestViaHost) { this.requestViaHost(action); return; }
        this.pending = { action, focus: focusedElement(), onCancel };
        this.changed();
    };
    cancel = () => {
        const focus = this.pending?.focus;
        this.pending?.onCancel?.();
        this.pending = null; this.changed();
        if (focus?.isConnected) focus.focus();
    };
    approve = () => {
        const pending = this.pending;
        if (!pending) return;
        this.pending = null;
        void this.execute(pending.action);
    };
    execute = async (action: ExitAction) => {
        this.departureRevision++;
        this.permitted = true;
        this.running = true;
        this.changed();
        const finish = () => {
            this.running = false;
            clearTimeout(this.timer);
            // Let approved document navigation deliver beforeunload, but never
            // leave a surviving page permanently unprotected after a failure.
            this.timer = setTimeout(() => { this.permitted = false; }, 1000);
        };
        try { if (await action() === false) this.permitted = false; }
        catch { this.permitted = false; }
        finally { finish(); }
    };
    dispose = () => { clearTimeout(this.timer); this.pending = null; this.permitted = false; };
}
const ExitContext = createContext<ExitCoordinator | null>(null);

function ExitDialog({ guard }: { guard: ExitCoordinator }) {
    const { locale } = useLocale();
    const text = copy[locale];
    const dialog = useRef<HTMLDialogElement>(null);
    const stay = useRef<HTMLButtonElement>(null);
    const leave = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        const node = dialog.current!;
        if (node.showModal) node.showModal(); else node.setAttribute('open', '');
        stay.current?.focus();
        return () => { if (node.open && node.close) node.close(); };
    }, []);
    const close = () => { if (dialog.current?.close) dialog.current.close(); };
    return createPortal(<dialog ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="room-exit-heading" aria-describedby="room-exit-body"
        style={{ position: 'fixed', inset: 0, margin: 'auto', maxWidth: 'min(28rem, calc(100vw - 2rem))', padding: '1.5rem', borderRadius: '1rem', background: '#16120d', color: '#fff9e9', border: '1px solid #c9a24e', zIndex: 2147483647 }}
        onClick={event => event.stopPropagation()}
        onCancel={event => { event.preventDefault(); close(); guard.cancel(); }}
        onKeyDownCapture={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); guard.cancel(); }
            if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); (document.activeElement === stay.current ? leave.current : stay.current)?.focus(); }
        }}>
        <h2 id="room-exit-heading">{text.heading}</h2>
        <p id="room-exit-body">{text.body}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem' }}>
            <button ref={stay} type="button" className="event-button event-button--secondary" onClick={() => { close(); guard.cancel(); }}>{text.stay}</button>
            <button ref={leave} type="button" className="event-button event-button--secondary" onClick={() => { close(); guard.approve(); }}>{text.leave}</button>
        </div>
    </dialog>, document.body);
}
function installLinks(guard: ExitCoordinator) {
    const click = (event: MouseEvent) => {
        if (!guard.active() || guard.permitted || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.composedPath().find(node => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
        if (!link || link.hasAttribute('download')) return;
        const target = link.target.toLowerCase();
        if (target && !['_self', '_parent', '_top'].includes(target)) return;
        const destination = new URL(link.href, location.href);
        if (!['http:', 'https:'].includes(destination.protocol)) return;
        if ((!target || target === '_self') && destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search && (destination.hash || link.getAttribute('href')?.startsWith('#'))) return;
        event.preventDefault(); event.stopImmediatePropagation();
        link.focus();
        guard.request(() => { link.click(); });
    };
    window.addEventListener('click', click, true);
    return () => window.removeEventListener('click', click, true);
}
type NavigationEntry = { key: string; url: string };
type BrowserNavigation = EventTarget & {
    currentEntry: NavigationEntry | null;
    traverseTo: (key: string) => { finished: Promise<unknown> };
};
function installHistory(guard: ExitCoordinator) {
    const navigation = (window as Window & { navigation?: BrowserNavigation }).navigation;
    if (!navigation) return installHistoryFallback(guard);
    let current = navigation.currentEntry;
    let restoring: { original: NavigationEntry; destination: NavigationEntry } | null = null;
    const changed = (event: Event) => {
        if ((event as Event & { navigationType?: string }).navigationType !== 'traverse') current = navigation.currentEntry;
    };
    const pop = (event: PopStateEvent) => {
        const destination = navigation.currentEntry;
        if (!destination || !current) return;
        if (restoring) {
            event.stopImmediatePropagation();
            if (destination.key !== restoring.original.key) return;
            const target = restoring.destination;
            current = restoring.original;
            restoring = null;
            guard.request(async () => { await navigation.traverseTo(target.key).finished; });
            return;
        }
        const from = new URL(current.url);
        const to = new URL(destination.url);
        if (!guard.active() || guard.permitted || (from.pathname === to.pathname && from.search === to.search)) { current = destination; return; }
        event.stopImmediatePropagation();
        restoring = { original: current, destination };
        // Cancelled Navigation API traverse events can consume a browser's
        // Forward cursor. Instead restore the exact entry before opening the
        // dialog, swallowing BOTH popstates before Next sees either. No push,
        // sentinel, changed state payload or destroyed Forward history.
        void navigation.traverseTo(current.key).finished.catch(() => { restoring = null; current = navigation.currentEntry; });
    };
    navigation.addEventListener('currententrychange', changed);
    window.addEventListener('popstate', pop, true);
    return () => { navigation.removeEventListener('currententrychange', changed); window.removeEventListener('popstate', pop, true); };
}
const BRIDGE = 'hb-room-exit';
const UNLOAD_QUERY = 'hb-room-exit-unload-query';
const REGISTER = 'hb-room-exit-register';
function installChildBridge(guard: ExitCoordinator) {
    const sessionId = /^\/session\/([^/]+)\/?$/.exec(location.pathname)?.[1];
    if (window.parent === window || !sessionId || new URLSearchParams(location.search).get('surface') !== 'cockpit') return;
    const generation = crypto.randomUUID();
    let host: string | null = null;
    let pending: { id: string; action: ExitAction; focus: HTMLElement | null } | null = null;
    const post = (message: Record<string, unknown>) => parent.postMessage({ type: BRIDGE, sessionId, generation, host, ...message }, location.origin);
    const state = () => { if (host) post({ event: 'state', active: guard.active() }); };
    const release = () => {
        host = null; guard.hosted = false; guard.hostRegistration = null;
        guard.requestViaHost = null; pending = null; guard.permitted = false;
    };
    const receive = (event: MessageEvent) => {
        if (event.origin !== location.origin || event.source !== parent || event.data?.type !== BRIDGE || event.data.sessionId !== sessionId) return;
        const data = event.data;
        if (data.event === 'probe') { show(); return; }
        if (data.generation !== generation) return;
        if (data.event === 'host' && typeof data.host === 'string') {
            if (host !== data.host) release();
            host = data.host;
            guard.hosted = true;
            guard.hostRegistration = { generation, host: data.host, document };
            guard.requestViaHost = action => {
                if (pending) return;
                pending = { id: crypto.randomUUID(), action, focus: focusedElement() };
                post({ event: 'request', id: pending.id });
            };
            state();
        } else if (data.host !== host || !host) return;
        else if (data.event === 'choice' && pending && data.id === pending.id && typeof data.approved === 'boolean') {
            const request = pending; pending = null;
            const approvedHost = host;
            if (data.approved) void guard.execute(request.action).finally(() => {
                if (host === approvedHost) post({ event: 'done', id: request.id });
            });
            else if (request.focus?.isConnected) request.focus.focus();
        } else if (data.event === 'release') release();
    };
    const hide = () => { post({ event: 'retire' }); release(); };
    const show = () => {
        try {
            // Document cannot be cloned by postMessage. Pass its identity only
            // across this synchronous, same-origin boundary, then challenge
            // the corresponding child generation over postMessage.
            parent.dispatchEvent(new CustomEvent(REGISTER, { detail: { source: window, document, sessionId, generation } }));
        } catch { /* Standalone guard remains effective without a host. */ }
    };
    window.addEventListener('message', receive);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    const unsubscribe = guard.subscribe(state);
    show();
    const hello = setInterval(() => { if (!guard.hosted) show(); }, 1000);
    return () => {
        hide(); clearInterval(hello); unsubscribe();
        window.removeEventListener('message', receive);
        window.removeEventListener('pagehide', hide);
        window.removeEventListener('pageshow', show);
    };
}

/** WindowProxy survives navigation: require the current Document AND a fresh
 * challenge/response from its child generation before it can own a room. */
export function useStaffRoomExitBridge(frame: RefObject<HTMLIFrameElement | null>, sessionId: string, enabled: boolean) {
    const guard = useContext(ExitContext);
    useEffect(() => {
        if (!guard) return;
        const element = frame.current;
        const key = {};
        type Registration = { document: Document; generation: string; host: string; ready: boolean; departureRevision: number };
        let registration: Registration | null = null;
        let pendingAction: ExitAction | null = null;
        let completion: { id: string; finish: () => void } | null = null;
        let detachHide: (() => void) | null = null;
        const currentDocument = () => {
            try { return element?.contentDocument ?? null; } catch { return null; }
        };
        const post = (message: Record<string, unknown>) => element?.contentWindow?.postMessage({ type: BRIDGE, sessionId, generation: registration?.generation, host: registration?.host, ...message }, location.origin);
        const invalidate = () => {
            if (registration) guard.permitted = false;
            registration = null;
            detachHide?.(); detachHide = null;
            if (pendingAction && guard.pending?.action === pendingAction) guard.cancel();
            pendingAction = null;
            if (completion) { completion.finish(); guard.permitted = false; }
            guard.setActive(key, false);
        };
        const checkDocument = () => {
            if (registration && registration.document !== currentDocument()) invalidate();
        };
        const load = () => { checkDocument(); post({ event: 'probe' }); };
        const register = (event: Event) => {
            checkDocument();
            const data = (event as CustomEvent).detail;
            const doc = currentDocument();
            if (!enabled || !doc || data?.source !== element?.contentWindow || data.document !== doc || data.sessionId !== sessionId || typeof data.generation !== 'string' || data.generation.length > 80) return;
            if (!registration || registration.generation !== data.generation) {
                invalidate();
                registration = { document: doc, generation: data.generation, host: crypto.randomUUID(), ready: false, departureRevision: guard.departureRevision };
                const child = doc.defaultView;
                child?.addEventListener('pagehide', invalidate);
                detachHide = () => child?.removeEventListener('pagehide', invalidate);
            }
            post({ event: 'host' });
        };
        const receive = (event: MessageEvent) => {
            checkDocument();
            if (!enabled || event.origin !== location.origin || event.source !== element?.contentWindow || event.data?.type !== BRIDGE || event.data.sessionId !== sessionId) return;
            const data = event.data;
            if (!registration || data.generation !== registration.generation || data.host !== registration.host) return;
            if (data.event === 'state' && typeof data.active === 'boolean') {
                registration.ready = true;
                guard.setActive(key, data.active);
            } else if (!registration.ready) return;
            else if (data.event === 'retire') invalidate();
            else if (data.event === 'request' && typeof data.id === 'string' && data.id.length <= 80) {
                const id = data.id;
                const owner = registration;
                if (guard.pending || guard.running || completion) { post({ event: 'choice', id, approved: false }); return; }
                pendingAction = () => new Promise<void>(resolve => {
                    if (registration !== owner || currentDocument() !== owner.document) { invalidate(); resolve(); return; }
                    const timer = setTimeout(() => { completion = null; resolve(); }, 30_000);
                    completion = { id, finish: () => { clearTimeout(timer); completion = null; resolve(); } };
                    post({ event: 'choice', id, approved: true });
                });
                guard.request(pendingAction, () => {
                    if (registration === owner) post({ event: 'choice', id, approved: false });
                });
            } else if (data.event === 'done' && completion?.id === data.id) completion?.finish();
        };
        const unloadQuery = (event: Event) => {
            checkDocument();
            const detail = (event as CustomEvent).detail;
            if (!registration?.ready || detail?.source !== element?.contentWindow || detail.document !== registration.document || detail.generation !== registration.generation || detail.host !== registration.host) return;
            if (guard.departureRevision > registration.departureRevision && (guard.permitted || guard.nativeUnloadInProgress)) event.preventDefault();
        };
        element?.addEventListener('load', load);
        window.addEventListener(REGISTER, register);
        window.addEventListener(UNLOAD_QUERY, unloadQuery);
        window.addEventListener('message', receive);
        post({ event: 'probe' });
        return () => {
            post({ event: 'release' });
            invalidate();
            element?.removeEventListener('load', load);
            window.removeEventListener(REGISTER, register);
            window.removeEventListener(UNLOAD_QUERY, unloadQuery);
            window.removeEventListener('message', receive);
        };
    }, [guard, frame, sessionId, enabled]);
}
function Provider({ children }: { children: ReactNode }) {
    const [guard] = useState(() => new ExitCoordinator());
    useSyncExternalStore(guard.subscribe, guard.snapshot, guard.snapshot);
    useEffect(() => installLinks(guard), [guard]);
    useEffect(() => installHistory(guard), [guard]);
    useEffect(() => installChildBridge(guard), [guard]);
    useEffect(() => {
        let reset: ReturnType<typeof setTimeout> | undefined;
        const unload = (event: BeforeUnloadEvent) => {
            if (!guard.active() || guard.permitted) return;
            if (guard.hosted) {
                try {
                    const query = new CustomEvent(UNLOAD_QUERY, { cancelable: true, detail: { source: window, ...guard.hostRegistration } });
                    if (!parent.dispatchEvent(query)) return;
                } catch { /* A detached/cross-origin host cannot suppress us. */ }
            }
            guard.departureRevision++;
            guard.nativeUnloadInProgress = true;
            clearTimeout(reset);
            reset = setTimeout(() => { guard.nativeUnloadInProgress = false; }, 0);
            event.preventDefault(); event.returnValue = '';
        };
        window.addEventListener('beforeunload', unload);
        return () => { clearTimeout(reset); guard.nativeUnloadInProgress = false; window.removeEventListener('beforeunload', unload); };
    }, [guard]);
    useEffect(() => () => guard.dispose(), [guard]);
    return <ExitContext.Provider value={guard}>{children}{guard.pending && <ExitDialog guard={guard} />}</ExitContext.Provider>;
}
/** Nested room entry boundaries reuse the root owner, never mount two guards. */
export function RoomExitProvider({ children }: { children: ReactNode }) {
    const existing = useContext(ExitContext);
    return existing ? children : <Provider>{children}</Provider>;
}
export function useRoomExit(active = false) {
    const guard = useContext(ExitContext);
    const key = useMemo(() => ({}), []);
    useEffect(() => { guard?.setActive(key, active); return () => guard?.setActive(key, false); }, [guard, key, active]);
    return guard?.request ?? ((action: ExitAction) => { void action(); });
}
