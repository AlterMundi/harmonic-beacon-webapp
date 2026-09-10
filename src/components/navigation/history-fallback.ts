type Guard = {
    active: () => boolean;
    permitted: boolean;
    request: (action: () => Promise<void>) => void;
};
const POSITION = '__hbRoomHistory';
type Position = { document: string; index: number };
type Entry = { position: Position; url: string };

/** Index real entries, never insert a sentinel. Keep Next's opaque fields.
 * Installed when the root client module loads, not when a room becomes active,
 * so same-document entries created before admission are also reversible. */
function createJournal() {
    // Reload can make earlier entries same-document with the replacement.
    // Retain their journal lineage/position instead of orphaning Back/Forward.
    const saved = history.state?.[POSITION] as Position | undefined;
    const initial = saved && typeof saved.document === 'string' && Number.isSafeInteger(saved.index)
        ? saved : { document: crypto.randomUUID(), index: 0 };
    const documentId = initial.document;
    const push = history.pushState;
    const replace = history.replaceState;
    let current: Entry = { position: initial, url: location.href };
    const position = (state: unknown): Position | undefined => {
        const value = (state as Record<string, Position> | null)?.[POSITION];
        return value?.document === documentId && Number.isSafeInteger(value.index) ? value : undefined;
    };
    const stamp = (data: unknown, value: Position) => ({ ...(data as object | null), [POSITION]: value });
    replace.call(history, stamp(history.state, current.position), '', location.href);
    history.pushState = function (data, unused, url) {
        const next = { document: documentId, index: current.position.index + 1 };
        push.call(this, stamp(data, next), unused, url);
        current = { position: next, url: location.href };
    };
    history.replaceState = function (data, unused, url) {
        replace.call(this, stamp(data, current.position), unused, url);
        current = { ...current, url: location.href };
    };
    let guard: Guard | null = null;
    let restoring: { original: Entry; destination: Entry } | null = null;
    let finish: (() => void) | null = null;
    const pop = (event: PopStateEvent) => {
        let next = position(event.state);
        // Fragment entries inherit the current state. Give a new fragment its
        // own position, without pushing or replacing any forward entries.
        if (next?.index === current.position.index && location.href !== current.url) {
            next = { document: documentId, index: current.position.index + 1 };
            replace.call(history, stamp(event.state, next), '', location.href);
        }
        if (!next) return; // Other documents are protected by beforeunload.
        const destination = { position: next, url: location.href };
        if (restoring) {
            event.stopImmediatePropagation();
            if (next.index !== restoring.original.position.index) return;
            const target = restoring.destination;
            current = restoring.original;
            restoring = null;
            guard?.request(() => new Promise<void>(resolve => {
                finish = resolve;
                history.go(target.position.index - current.position.index);
            }));
            return;
        }
        const from = new URL(current.url);
        const to = new URL(destination.url);
        if (!guard?.active() || guard.permitted || (from.pathname === to.pathname && from.search === to.search)) {
            current = destination;
            finish?.(); finish = null;
            return;
        }
        event.stopImmediatePropagation();
        restoring = { original: current, destination };
        history.go(current.position.index - next.index);
    };
    window.addEventListener('popstate', pop, true);
    return (owner: Guard) => {
        guard = owner;
        return () => { if (guard === owner) { guard = null; restoring = null; finish?.(); finish = null; } };
    };
}

// The root provider module lives for the document. Retain indexing while no
// room is active; React StrictMode cleanup must not discard entry positions.
const journal = typeof window !== 'undefined' && !('navigation' in window && window.navigation)
    ? createJournal() : null;
export function installHistoryFallback(guard: Guard) { return journal?.(guard); }
