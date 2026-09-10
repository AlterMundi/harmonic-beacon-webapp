import type { Room } from 'livekit-client';

const departures = new WeakMap<Room, Promise<void>>();
/** A Room instance is retired, never reused, after a committed departure. */
export function disconnectRoomOnce(room: Room): Promise<void> {
    let departure = departures.get(room);
    if (!departure) {
        departure = room.disconnect();
        departures.set(room, departure ?? Promise.resolve());
    }
    return departures.get(room)!;
}

/** pagehide is committed, unlike beforeunload. Release even for bfcache: a
 * frozen document cannot own a live session. pageshow rebuilds with fresh
 * authorization rather than claiming the frozen WebRTC transport survived. */
export function committedRoomLifecycle(retire: () => void, restore: () => void) {
    const show = (event: PageTransitionEvent) => { if (event.persisted) restore(); };
    window.addEventListener('pagehide', retire);
    window.addEventListener('pageshow', show);
    return () => {
        window.removeEventListener('pagehide', retire);
        window.removeEventListener('pageshow', show);
        retire();
    };
}
