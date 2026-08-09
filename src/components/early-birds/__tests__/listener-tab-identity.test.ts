// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getOrCreateEarlyBirdDeviceId,
    ListenerTabIdentityCoordinator,
    type ListenerIdentityChannel,
    type ListenerIdentityChannelFactory,
} from '../listener-tab-identity';

class MemoryStorage implements Storage {
    private readonly values: Map<string, string>;

    constructor(seed?: Map<string, string>) {
        this.values = new Map(seed);
    }

    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key: string) { return this.values.get(key) ?? null; }
    key(index: number) { return [...this.values.keys()][index] ?? null; }
    removeItem(key: string) { this.values.delete(key); }
    setItem(key: string, value: string) { this.values.set(key, value); }
    clone() { return new MemoryStorage(this.values); }
}

class ChannelHub {
    private readonly members = new Map<string, Set<HubChannel>>();

    factory: ListenerIdentityChannelFactory = (name) => {
        const channel = new HubChannel(name, this);
        const members = this.members.get(name) ?? new Set<HubChannel>();
        members.add(channel);
        this.members.set(name, members);
        return channel;
    };

    broadcast(sender: HubChannel, message: unknown) {
        for (const member of this.members.get(sender.name) ?? []) {
            if (member === sender) continue;
            queueMicrotask(() => member.onmessage?.({ data: message } as MessageEvent<unknown>));
        }
    }

    close(channel: HubChannel) {
        this.members.get(channel.name)?.delete(channel);
    }
}

class HubChannel implements ListenerIdentityChannel {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

    constructor(readonly name: string, private readonly hub: ChannelHub) {}
    postMessage(message: unknown) { this.hub.broadcast(this, message); }
    close() { this.hub.close(this); }
}

afterEach(() => vi.restoreAllMocks());

describe('Listener per-tab identity handshake', () => {
    it('replaces a sessionStorage id cloned from a live tab', async () => {
        const hub = new ChannelHub();
        const firstStorage = new MemoryStorage();
        const first = new ListenerTabIdentityCoordinator(firstStorage, hub.factory, 2);
        const firstId = await first.resolve();

        const clonedStorage = firstStorage.clone();
        expect(getOrCreateEarlyBirdDeviceId(clonedStorage)).toBe(firstId);
        const duplicate = new ListenerTabIdentityCoordinator(clonedStorage, hub.factory, 2);
        const duplicateId = await duplicate.resolve();

        expect(duplicateId).not.toBe(firstId);
        expect(getOrCreateEarlyBirdDeviceId(firstStorage)).toBe(firstId);
        expect(getOrCreateEarlyBirdDeviceId(clonedStorage)).toBe(duplicateId);
        first.close();
        duplicate.close();
    });

    it('preserves the tab id across reload after the previous channel closes', async () => {
        const hub = new ChannelHub();
        const storage = new MemoryStorage();
        const beforeReload = new ListenerTabIdentityCoordinator(storage, hub.factory, 2);
        const originalId = await beforeReload.resolve();
        beforeReload.close();

        const afterReload = new ListenerTabIdentityCoordinator(storage, hub.factory, 2);
        await expect(afterReload.resolve()).resolves.toBe(originalId);
        afterReload.close();
    });

    it('fails soft when BroadcastChannel is unavailable', async () => {
        const storage = new MemoryStorage();
        const existingId = getOrCreateEarlyBirdDeviceId(storage);
        const identity = new ListenerTabIdentityCoordinator(storage, () => null, 2);

        await expect(identity.resolve()).resolves.toBe(existingId);
        identity.close();
    });
});
