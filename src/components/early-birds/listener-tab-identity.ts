const DEVICE_STORAGE_KEY = 'hb_earlybird_device_id';
const IDENTITY_CHANNEL = 'hb_listener_tab_identity_v1';
const DEFAULT_PROBE_MS = 50;
const MAX_COLLISION_ROUNDS = 3;

type IdentityMessage =
    | { kind: 'probe'; deviceId: string; probeId: string }
    | { kind: 'occupied'; deviceId: string; probeId: string };

export type ListenerIdentityChannel = {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    postMessage(message: IdentityMessage): void;
    close(): void;
};

export type ListenerIdentityChannelFactory = (name: string) => ListenerIdentityChannel | null;

function randomId(): string {
    return typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function validDeviceId(value: string | null): value is string {
    return Boolean(value && /^[A-Za-z0-9_-]{16,200}$/.test(value));
}

export function getOrCreateEarlyBirdDeviceId(storage: Storage): string {
    const existing = storage.getItem(DEVICE_STORAGE_KEY);
    if (validDeviceId(existing)) return existing;
    const generated = randomId();
    storage.setItem(DEVICE_STORAGE_KEY, generated);
    return generated;
}

function replaceEarlyBirdDeviceId(storage: Storage): string {
    const generated = randomId();
    storage.setItem(DEVICE_STORAGE_KEY, generated);
    return generated;
}

function browserChannelFactory(name: string): ListenerIdentityChannel | null {
    if (typeof BroadcastChannel !== 'function') return null;
    try {
        return new BroadcastChannel(name);
    } catch {
        return null;
    }
}

function identityMessage(value: unknown): IdentityMessage | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<IdentityMessage>;
    if (
        (candidate.kind !== 'probe' && candidate.kind !== 'occupied')
        || !validDeviceId(candidate.deviceId ?? null)
        || typeof candidate.probeId !== 'string'
        || !/^[A-Za-z0-9_-]{16,200}$/.test(candidate.probeId)
    ) return null;
    return candidate as IdentityMessage;
}

/**
 * Browsers may clone sessionStorage when a tab is duplicated. Coordinate only
 * long enough to detect a live owner of that cloned id; reloads keep the same
 * id because the previous document closes its channel before the next claim.
 */
export class ListenerTabIdentityCoordinator {
    private readonly channel: ListenerIdentityChannel | null;
    private readonly tabNonce = randomId();
    private deviceId: string;
    private pendingProbe: { id: string; occupied: boolean } | null = null;
    private resolution: Promise<string> | null = null;
    private closed = false;

    constructor(
        private readonly storage: Storage,
        channelFactory: ListenerIdentityChannelFactory = browserChannelFactory,
        private readonly probeMs = DEFAULT_PROBE_MS,
    ) {
        this.deviceId = getOrCreateEarlyBirdDeviceId(storage);
        let channel: ListenerIdentityChannel | null = null;
        try {
            channel = channelFactory(IDENTITY_CHANNEL);
        } catch {
            // Unsupported/restricted BroadcastChannel is fail-soft. The server
            // remains the final two-connection authority.
        }
        this.channel = channel;
        if (channel) channel.onmessage = (event) => this.handleMessage(event.data);
    }

    resolve(): Promise<string> {
        if (this.resolution) return this.resolution;
        this.resolution = this.resolveOnce();
        return this.resolution;
    }

    close(): void {
        this.closed = true;
        this.pendingProbe = null;
        if (this.channel) {
            this.channel.onmessage = null;
            this.channel.close();
        }
    }

    private handleMessage(value: unknown): void {
        if (this.closed || !this.channel) return;
        const message = identityMessage(value);
        if (!message || message.deviceId !== this.deviceId) return;
        if (message.kind === 'probe') {
            this.channel.postMessage({
                kind: 'occupied',
                deviceId: this.deviceId,
                probeId: message.probeId,
            });
            return;
        }
        if (this.pendingProbe?.id === message.probeId) {
            this.pendingProbe.occupied = true;
        }
    }

    private async resolveOnce(): Promise<string> {
        if (!this.channel) return this.deviceId;
        for (let round = 0; round < MAX_COLLISION_ROUNDS && !this.closed; round += 1) {
            const probeId = `${this.tabNonce}_${round}`;
            const pending = { id: probeId, occupied: false };
            this.pendingProbe = pending;
            this.channel.postMessage({ kind: 'probe', deviceId: this.deviceId, probeId });
            await new Promise<void>((resolve) => window.setTimeout(resolve, this.probeMs));
            if (this.pendingProbe === pending) this.pendingProbe = null;
            if (!pending.occupied) return this.deviceId;
            this.deviceId = replaceEarlyBirdDeviceId(this.storage);
        }
        return this.deviceId;
    }
}
