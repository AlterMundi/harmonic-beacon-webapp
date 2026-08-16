import type { ListenerPresenceSnapshot } from './presence';

let lastGood: ListenerPresenceSnapshot | null = null;

export function cachedListenerPresence(): ListenerPresenceSnapshot | null {
    return lastGood;
}

export function rememberListenerPresence(snapshot: ListenerPresenceSnapshot): void {
    lastGood = snapshot;
}

export function resetListenerPresenceRouteCacheForTests(): void {
    lastGood = null;
}
