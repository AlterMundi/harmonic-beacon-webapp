import { createHmac } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import {
    listeningAccessDecision,
    type EarlyBirdListeningAccess,
} from './access';
import {
    lockEarlyBirdQuotaAccount,
    serializeEarlyBirdQuotaSnapshot,
    settleLockedEarlyBirdQuota,
    withQuotaTransaction,
    withLockedQuotaTransaction,
    type SerializedEarlyBirdQuotaSnapshot,
} from './quota';

export const EARLY_BIRD_MAX_STREAM_DEVICES = 2;
export const EARLY_BIRD_LEASE_TTL_MS = 3 * 60 * 1000;
export const EARLY_BIRD_ORIGIN_MAX_SIGNATURE_TTL_SECONDS = 10 * 60;
export const EARLY_BIRD_ORIGIN_MANIFEST_TTL_SECONDS = 60;
export const EARLY_BIRD_LEASE_MANIFEST_PATH = '/api/early-birds/stream/manifest';
export const EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID = 'early-birds-free-for-all';

export type ListenerLeasePresence = {
    state: 'IDLE' | 'LISTENING';
    macroRegion: 'NORTH_AMERICA' | 'LATIN_AMERICA' | 'EUROPE' | 'AFRICA' | 'ASIA' | 'OCEANIA' | 'UNKNOWN';
};

const EARLY_BIRD_FREE_FOR_ALL_ACCOUNT = {
    id: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
    name: 'Public Listener',
    email: 'public-listener@free.invalid',
    emailVerified: false,
} as const;

export type StreamUrlIssueRequest = {
    accountId: string;
    leaseId: string;
    leaseGeneration: number;
    issuedAt: Date;
    leaseExpiresAt: Date;
};

export type StreamUrlGrant = {
    manifestUrl: string;
    expiresAt: Date;
};

/** Integration seam implemented by the deterministic HLS origin slice. */
export interface EarlyBirdStreamUrlIssuer {
    issue(request: StreamUrlIssueRequest): Promise<StreamUrlGrant>;
}

export class EarlyBirdStreamIssuerUnavailableError extends Error {
    constructor() {
        super('EarlyBird stream URL issuer is not configured');
        this.name = 'EarlyBirdStreamIssuerUnavailableError';
    }
}

class EnvironmentManifestIssuer implements EarlyBirdStreamUrlIssuer {
    async issue(request: StreamUrlIssueRequest): Promise<StreamUrlGrant> {
        // Validate the origin integration at lease issuance, but expose only a
        // stable same-origin URL to the browser. The route signs and refreshes
        // the upstream manifest on every HLS poll.
        earlyBirdOriginConfig();
        const query = new URLSearchParams({
            leaseId: request.leaseId,
            leaseGeneration: String(request.leaseGeneration),
        });
        return {
            manifestUrl: `${EARLY_BIRD_LEASE_MANIFEST_PATH}?${query}`,
            expiresAt: request.leaseExpiresAt,
        };
    }
}

let issuerOverride: EarlyBirdStreamUrlIssuer | null = null;

export function setEarlyBirdStreamUrlIssuerForTests(
    issuer: EarlyBirdStreamUrlIssuer | null,
): void {
    issuerOverride = issuer;
}

export function earlyBirdStreamUrlIssuer(): EarlyBirdStreamUrlIssuer {
    return issuerOverride ?? new EnvironmentManifestIssuer();
}

function devicePepper(): string {
    const configured = process.env.EARLY_BIRDS_DEVICE_PEPPER?.trim();
    if (configured) return configured;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('EARLY_BIRDS_DEVICE_PEPPER is required');
    }
    return 'early-birds-local-device-pepper-change-before-deploy';
}

export function earlyBirdDeviceDigest(deviceId: string, pepper = devicePepper()): string {
    const normalized = deviceId.trim();
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(normalized)) throw new Error('invalid device id');
    return createHmac('sha256', pepper)
        .update(`early-birds-device:v1:${normalized}`, 'utf8')
        .digest('hex');
}

export type LeaseAcquisition = {
    leaseId: string;
    leaseGeneration: number;
    presenceSequence: number;
    leaseExpiresAt: Date;
    evictedLeaseId: string | null;
    stream: StreamUrlGrant;
    serverNow: Date;
    accessKind: EarlyBirdListeningAccess['kind'] | 'free-for-all';
    quota: SerializedEarlyBirdQuotaSnapshot | null;
};

export class EarlyBirdAccessDeniedError extends Error {
    constructor() {
        super('Active Listener access is required');
        this.name = 'EarlyBirdAccessDeniedError';
    }
}

export class EarlyBirdDeviceCapacityError extends Error {
    constructor() {
        super('Two EarlyBird stream devices are already active');
        this.name = 'EarlyBirdDeviceCapacityError';
    }
}

export class EarlyBirdLeaseInactiveError extends Error {
    readonly reason: 'evicted' | 'expired' | 'missing';

    constructor(reason: 'evicted' | 'expired' | 'missing' = 'missing') {
        super('The stream lease is no longer active');
        this.name = 'EarlyBirdLeaseInactiveError';
        this.reason = reason;
    }
}

export class EarlyBirdLeaseRefreshRequiredError extends Error {
    constructor() {
        super('The stream lease generation or presence sequence is stale');
        this.name = 'EarlyBirdLeaseRefreshRequiredError';
    }
}

function cappedLeaseExpiry(now: Date, allowedUntil: Date | null): Date {
    const ttlExpiry = new Date(now.getTime() + EARLY_BIRD_LEASE_TTL_MS);
    return allowedUntil && allowedUntil < ttlExpiry ? allowedUntil : ttlExpiry;
}

type StreamTransactionClient = Prisma.TransactionClient;

async function streamTransaction<T>(
    accountId: string,
    explicitNow: Date | undefined,
    callback: (tx: StreamTransactionClient, now: Date) => Promise<T>,
): Promise<T> {
    if (explicitNow) {
        return withQuotaTransaction(async (tx) => {
            await lockEarlyBirdQuotaAccount(tx, accountId);
            return callback(tx, explicitNow);
        });
    }
    return withLockedQuotaTransaction(accountId, callback);
}

export type EarlyBirdOriginConfig = {
    origin: string;
    artifactId: string;
    signingSecret: string;
};

export function earlyBirdOriginConfig(
    environment: NodeJS.ProcessEnv = process.env,
): EarlyBirdOriginConfig {
    const origin = environment.EARLY_BIRDS_STREAM_ORIGIN?.trim();
    const artifactId = environment.EARLY_BIRDS_STREAM_ARTIFACT_ID?.trim();
    const signingSecret = environment.EARLY_BIRDS_STREAM_SIGNING_SECRET?.trim();
    if (!origin || !artifactId || !signingSecret || signingSecret.length < 32) {
        throw new EarlyBirdStreamIssuerUnavailableError();
    }
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(artifactId)) {
        throw new EarlyBirdStreamIssuerUnavailableError();
    }
    let parsed: URL;
    try {
        parsed = new URL(origin);
    } catch {
        throw new EarlyBirdStreamIssuerUnavailableError();
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new EarlyBirdStreamIssuerUnavailableError();
    }
    if (environment.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        throw new EarlyBirdStreamIssuerUnavailableError();
    }
    return {
        origin: parsed.origin,
        artifactId,
        signingSecret,
    };
}

export function earlyBirdOriginManifestPath(artifactId: string): string {
    return `/v1/hls/${artifactId}/live.m3u8`;
}

/** Byte-exact peer of services/beacon-stream/src/auth.mjs#signPath. */
export function signEarlyBirdOriginPath(input: {
    secret: string;
    pathname: string;
    expiresAt: number;
    method?: 'GET';
}): string {
    if (input.secret.length < 32) throw new EarlyBirdStreamIssuerUnavailableError();
    if (!Number.isSafeInteger(input.expiresAt)) throw new Error('expiresAt must be whole seconds');
    const canonical = `${input.method ?? 'GET'}\n${input.pathname}\n${input.expiresAt}`;
    return createHmac('sha256', input.secret).update(canonical).digest('base64url');
}

export function signedEarlyBirdOriginManifestUrl(input: {
    config: EarlyBirdOriginConfig;
    leaseExpiresAt: Date;
    now?: Date;
}): string {
    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
    const leaseExpirySeconds = Math.floor(input.leaseExpiresAt.getTime() / 1000);
    const expiresAt = Math.min(
        leaseExpirySeconds,
        nowSeconds + Math.min(
            EARLY_BIRD_ORIGIN_MANIFEST_TTL_SECONDS,
            EARLY_BIRD_ORIGIN_MAX_SIGNATURE_TTL_SECONDS,
        ),
    );
    if (expiresAt <= nowSeconds) throw new EarlyBirdLeaseInactiveError();
    const pathname = earlyBirdOriginManifestPath(input.config.artifactId);
    const url = new URL(pathname, input.config.origin);
    url.searchParams.set('exp', String(expiresAt));
    url.searchParams.set('sig', signEarlyBirdOriginPath({
        secret: input.config.signingSecret,
        pathname,
        expiresAt,
    }));
    return url.toString();
}

export function validSignedOriginManifest(
    body: string,
    config: EarlyBirdOriginConfig,
): boolean {
    if (body.length < 8 || body.length > 256_000 || !body.startsWith('#EXTM3U\n')) return false;
    const mediaLines = body.split('\n').filter((line) => line && !line.startsWith('#'));
    if (mediaLines.length < 1) return false;
    const segmentPrefix = `/v1/hls/${config.artifactId}/segments/`;
    const validMediaUrl = (value: string) => {
        try {
            const url = new URL(value);
            return (
                url.origin === config.origin &&
                url.pathname.startsWith(segmentPrefix) &&
                /^\d+$/.test(url.searchParams.get('exp') ?? '') &&
                Boolean(url.searchParams.get('sig'))
            );
        } catch {
            return false;
        }
    };
    const mapLines = body.split('\n').filter((line) => line.startsWith('#EXT-X-MAP:'));
    const mapUris = mapLines.map((line) => line.match(/(?:^|[:,])URI="([^"]+)"(?:,|$)/)?.[1] ?? '');
    return mediaLines.every(validMediaUrl)
        && mapUris.every((uri) => uri !== '' && validMediaUrl(uri));
}

export async function authorizeEarlyBirdStreamLease(
    accountId: string,
    leaseId: string,
    leaseGeneration: number,
    explicitNow?: Date,
) {
    const outcome = await streamTransaction(accountId, explicitNow, async (tx, now) => {
        const projection = await tx.earlyBirdMembershipProjection.findUnique({ where: { accountId } });
        const quota = await settleLockedEarlyBirdQuota({ tx, accountId, projection, now });
        const access = listeningAccessDecision(projection, quota, now);
        if (!access.allowed) return { kind: 'denied' as const };
        const lease = await tx.earlyBirdStreamLease.findFirst({
            where: { id: leaseId, accountId, generation: leaseGeneration },
        });
        if (!lease) return { kind: 'inactive' as const, reason: 'missing' as const };
        if (lease.evictedAt !== null) return { kind: 'inactive' as const, reason: 'evicted' as const };
        if (lease.expiresAt <= now) return { kind: 'inactive' as const, reason: 'expired' as const };
        return { kind: 'ok' as const, lease, serverNow: now };
    });
    if (outcome.kind === 'denied') throw new EarlyBirdAccessDeniedError();
    if (outcome.kind === 'inactive') throw new EarlyBirdLeaseInactiveError(outcome.reason);
    return { lease: outcome.lease, serverNow: outcome.serverNow };
}

async function acquireEarlyBirdStreamLeaseWithMode(
    accountId: string,
    deviceId: string,
    explicitNow?: Date,
    issuer = earlyBirdStreamUrlIssuer(),
    mode: 'prepare' | 'claim' | 'play' = 'play',
): Promise<LeaseAcquisition> {
    const deviceDigest = earlyBirdDeviceDigest(deviceId);
    const evictOldest = mode !== 'prepare';
    const startListening = mode === 'play';

    const lease = await streamTransaction(accountId, explicitNow, async (tx, now) => {
        const projection = await tx.earlyBirdMembershipProjection.findUnique({ where: { accountId } });
        const quota = await settleLockedEarlyBirdQuota({ tx, accountId, projection, now });
        const access = listeningAccessDecision(projection, quota, now);
        if (!access.allowed) {
            return { kind: 'denied' as const };
        }
        let leaseExpiresAt = cappedLeaseExpiry(now, access.allowedUntil);
        if (leaseExpiresAt <= now) return { kind: 'denied' as const };

        const previous = await tx.earlyBirdStreamLease.findUnique({
            where: { accountId_deviceDigest: { accountId, deviceDigest } },
        });
        const active = await tx.earlyBirdStreamLease.findMany({
            where: {
                accountId,
                evictedAt: null,
                expiresAt: { gt: now },
                ...(previous ? { id: { not: previous.id } } : {}),
            },
            orderBy: [{ lastSeenAt: 'asc' }, { createdAt: 'asc' }],
            select: { id: true },
        });

        const overflow = Math.max(0, active.length - (EARLY_BIRD_MAX_STREAM_DEVICES - 1));
        if (!evictOldest && overflow > 0) return { kind: 'capacity' as const };
        const evicted = active.slice(0, overflow);
        if (evicted.length > 0) {
            await tx.earlyBirdStreamLease.updateMany({
                where: { id: { in: evicted.map(({ id }) => id) } },
                data: { evictedAt: now, presence: 'IDLE', presenceUpdatedAt: now },
            });
        }

        // A prepare lease may decode/prefetch for iOS, but it must always lose
        // an eviction contest against a device on which the person pressed play.
        const prioritySeenAt = evictOldest ? now : new Date(0);
        let current = previous
            ? await tx.earlyBirdStreamLease.update({
                where: { id: previous.id },
                data: {
                    createdAt: now,
                    lastSeenAt: prioritySeenAt,
                    expiresAt: leaseExpiresAt,
                    evictedAt: null,
                    presence: startListening ? 'LISTENING' : 'IDLE',
                    presenceUpdatedAt: now,
                    generation: { increment: 1 },
                    presenceSequence: 0,
                },
            })
            : await tx.earlyBirdStreamLease.create({
                data: {
                    accountId,
                    deviceDigest,
                    lastSeenAt: prioritySeenAt,
                    expiresAt: leaseExpiresAt,
                    presence: startListening ? 'LISTENING' : 'IDLE',
                    presenceUpdatedAt: now,
                    generation: 1,
                    presenceSequence: 0,
                },
            });
        const quotaAfter = await settleLockedEarlyBirdQuota({
            tx,
            accountId,
            projection,
            now,
            observeFreeListening: startListening,
        });
        const accessAfter = listeningAccessDecision(projection, quotaAfter, now);
        if (!accessAfter.allowed) {
            await tx.earlyBirdStreamLease.update({
                where: { id: current.id },
                data: { presence: 'IDLE', presenceUpdatedAt: now, expiresAt: now },
            });
            return { kind: 'denied' as const };
        }
        const finalExpiry = cappedLeaseExpiry(now, accessAfter.allowedUntil);
        if (finalExpiry.getTime() !== leaseExpiresAt.getTime()) {
            leaseExpiresAt = finalExpiry;
            current = await tx.earlyBirdStreamLease.update({
                where: { id: current.id },
                data: { expiresAt: leaseExpiresAt },
            });
        }
        const stream = await issuer.issue({
            accountId,
            leaseId: current.id,
            leaseGeneration: current.generation,
            issuedAt: now,
            leaseExpiresAt,
        });
        return {
            kind: 'ok' as const,
            current,
            evictedLeaseId: evicted[0]?.id ?? null,
            leaseExpiresAt,
            serverNow: now,
            access: accessAfter,
            stream,
        };
    });

    if (lease.kind === 'denied') throw new EarlyBirdAccessDeniedError();
    if (lease.kind === 'capacity') throw new EarlyBirdDeviceCapacityError();

    return {
        leaseId: lease.current.id,
        leaseGeneration: lease.current.generation,
        presenceSequence: lease.current.presenceSequence,
        leaseExpiresAt: lease.leaseExpiresAt,
        evictedLeaseId: lease.evictedLeaseId,
        stream: lease.stream,
        serverNow: lease.serverNow,
        accessKind: lease.access.kind,
        quota: lease.access.quota ? serializeEarlyBirdQuotaSnapshot(lease.access.quota) : null,
    };
}

/** Real playback: eviction-capable and immediately observed as LISTENING. */
export function acquireEarlyBirdStreamLease(
    accountId: string,
    deviceId: string,
    explicitNow?: Date,
    issuer = earlyBirdStreamUrlIssuer(),
): Promise<LeaseAcquisition> {
    return acquireEarlyBirdStreamLeaseWithMode(accountId, deviceId, explicitNow, issuer, 'play');
}

/** Eviction-capable source claim that remains IDLE and never creates an anchor. */
export function claimEarlyBirdStreamLease(
    accountId: string,
    deviceId: string,
    explicitNow?: Date,
    issuer = earlyBirdStreamUrlIssuer(),
): Promise<LeaseAcquisition> {
    return acquireEarlyBirdStreamLeaseWithMode(accountId, deviceId, explicitNow, issuer, 'claim');
}

export function prepareEarlyBirdStreamLease(
    accountId: string,
    deviceId: string,
    explicitNow?: Date,
    issuer = earlyBirdStreamUrlIssuer(),
): Promise<LeaseAcquisition> {
    return acquireEarlyBirdStreamLeaseWithMode(accountId, deviceId, explicitNow, issuer, 'prepare');
}

export async function heartbeatEarlyBirdStreamLease(
    accountId: string,
    leaseId: string,
    leaseGeneration: number,
    presenceSequence: number,
    explicitNow?: Date,
    issuer = earlyBirdStreamUrlIssuer(),
    refreshPriority = true,
    presence?: ListenerLeasePresence,
): Promise<{
    leaseExpiresAt: Date;
    stream: StreamUrlGrant;
    serverNow: Date;
    accessKind: EarlyBirdListeningAccess['kind'];
    quota: SerializedEarlyBirdQuotaSnapshot | null;
    leaseGeneration: number;
    presenceSequence: number;
}> {
    const outcome = await streamTransaction(accountId, explicitNow, async (tx, now) => {
        const projection = await tx.earlyBirdMembershipProjection.findUnique({ where: { accountId } });
        const quotaBefore = await settleLockedEarlyBirdQuota({
            tx,
            accountId,
            projection,
            now,
        });
        const current = await tx.earlyBirdStreamLease.findFirst({
            where: { id: leaseId, accountId },
        });
        if (!current) return { kind: 'inactive' as const, reason: 'missing' as const };
        if (current.evictedAt !== null) return { kind: 'inactive' as const, reason: 'evicted' as const };
        if (current.expiresAt <= now) return { kind: 'inactive' as const, reason: 'expired' as const };
        const nextPresence = presence?.state ?? current.presence;
        if (
            current.generation !== leaseGeneration
            || presenceSequence < current.presenceSequence
            || (presenceSequence === current.presenceSequence && nextPresence !== current.presence)
        ) {
            return { kind: 'refresh' as const };
        }
        const observedQuota = nextPresence === 'LISTENING'
            ? await settleLockedEarlyBirdQuota({
                tx,
                accountId,
                projection,
                now,
                observeFreeListening: true,
            })
            : quotaBefore;
        const accessBefore = listeningAccessDecision(projection, observedQuota, now);
        if (nextPresence === 'LISTENING' && !accessBefore.allowed) {
            await tx.earlyBirdStreamLease.update({
                where: { id: current.id },
                data: {
                    presence: 'IDLE',
                    presenceUpdatedAt: now,
                    presenceSequence: Math.max(current.presenceSequence, presenceSequence),
                    expiresAt: now,
                },
            });
            return { kind: 'denied' as const };
        }
        const provisionalExpiry = cappedLeaseExpiry(
            now,
            nextPresence === 'IDLE' ? null : accessBefore.allowedUntil,
        );
        const updated = await tx.earlyBirdStreamLease.update({
            where: { id: current.id },
            data: {
                ...(refreshPriority ? { lastSeenAt: now } : {}),
                expiresAt: provisionalExpiry,
                ...(presence && presenceSequence > current.presenceSequence ? {
                    presence: nextPresence,
                    macroRegion: presence.macroRegion,
                    presenceUpdatedAt: now,
                    presenceSequence,
                } : {}),
            },
        });
        const quotaAfter = await settleLockedEarlyBirdQuota({ tx, accountId, projection, now });
        const access = listeningAccessDecision(projection, quotaAfter, now);
        if (!access.allowed) {
            await tx.earlyBirdStreamLease.update({
                where: { id: current.id },
                data: { presence: 'IDLE', presenceUpdatedAt: now, expiresAt: now },
            });
            return { kind: 'denied' as const };
        }
        const leaseExpiresAt = cappedLeaseExpiry(now, access.allowedUntil);
        if (leaseExpiresAt.getTime() !== provisionalExpiry.getTime()) {
            await tx.earlyBirdStreamLease.update({
                where: { id: current.id },
                data: { expiresAt: leaseExpiresAt },
            });
        }
        return { kind: 'ok' as const, updated, leaseExpiresAt, serverNow: now, access };
    });

    if (outcome.kind === 'inactive') throw new EarlyBirdLeaseInactiveError(outcome.reason);
    if (outcome.kind === 'refresh') throw new EarlyBirdLeaseRefreshRequiredError();
    if (outcome.kind === 'denied') throw new EarlyBirdAccessDeniedError();

    const stream = await issuer.issue({
        accountId,
        leaseId: outcome.updated.id,
        leaseGeneration: outcome.updated.generation,
        issuedAt: outcome.serverNow,
        leaseExpiresAt: outcome.leaseExpiresAt,
    });
    return {
        leaseExpiresAt: outcome.leaseExpiresAt,
        stream,
        serverNow: outcome.serverNow,
        accessKind: outcome.access.kind,
        quota: outcome.access.quota ? serializeEarlyBirdQuotaSnapshot(outcome.access.quota) : null,
        leaseGeneration: outcome.updated.generation,
        presenceSequence: outcome.updated.presenceSequence,
    };
}

/**
 * Public-mode leases intentionally do not fabricate a membership projection.
 * They live under one non-PII technical account and remain usable only while
 * the route-level Free for All switch is enabled. Device identifiers are still
 * HMACed and origin URLs remain short-lived and signed.
 */
export async function acquireFreeForAllStreamLease(
    deviceId: string,
    now = new Date(),
    issuer = earlyBirdStreamUrlIssuer(),
): Promise<LeaseAcquisition> {
    const deviceDigest = earlyBirdDeviceDigest(deviceId);
    const leaseExpiresAt = new Date(now.getTime() + EARLY_BIRD_LEASE_TTL_MS);

    await prisma.earlyBirdUser.upsert({
        where: { id: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID },
        create: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT,
        update: {},
    });
    const lease = await prisma.earlyBirdStreamLease.upsert({
        where: {
            accountId_deviceDigest: {
                accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
                deviceDigest,
            },
        },
        create: {
            accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
            deviceDigest,
            lastSeenAt: now,
            expiresAt: leaseExpiresAt,
            generation: 1,
            presenceSequence: 0,
        },
        update: {
            createdAt: now,
            lastSeenAt: now,
            expiresAt: leaseExpiresAt,
            evictedAt: null,
            presence: 'IDLE',
            presenceUpdatedAt: now,
            generation: { increment: 1 },
            presenceSequence: 0,
        },
    });

    try {
        const stream = await issuer.issue({
            accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
            leaseId: lease.id,
            leaseGeneration: lease.generation,
            issuedAt: now,
            leaseExpiresAt,
        });
        return {
            leaseId: lease.id,
            leaseGeneration: lease.generation,
            presenceSequence: lease.presenceSequence,
            leaseExpiresAt,
            evictedLeaseId: null,
            stream,
            serverNow: now,
            accessKind: 'free-for-all',
            quota: null,
        };
    } catch (error) {
        await prisma.earlyBirdStreamLease.updateMany({
            where: {
                id: lease.id,
                accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
                generation: lease.generation,
            },
            data: { evictedAt: now },
        });
        throw error;
    }
}

export async function authorizeFreeForAllStreamLease(
    leaseId: string,
    leaseGeneration: number,
    now = new Date(),
) {
    const lease = await prisma.earlyBirdStreamLease.findFirst({
        where: {
            id: leaseId,
            accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
            generation: leaseGeneration,
        },
    });
    if (!lease) throw new EarlyBirdLeaseInactiveError('missing');
    if (lease.evictedAt !== null) throw new EarlyBirdLeaseInactiveError('evicted');
    if (lease.expiresAt <= now) throw new EarlyBirdLeaseInactiveError('expired');
    return lease;
}

export async function heartbeatFreeForAllStreamLease(
    leaseId: string,
    leaseGeneration: number,
    presenceSequence: number,
    now = new Date(),
    issuer = earlyBirdStreamUrlIssuer(),
    presence?: ListenerLeasePresence,
): Promise<{
    leaseExpiresAt: Date;
    stream: StreamUrlGrant;
    serverNow: Date;
    accessKind: 'free-for-all';
    quota: null;
    leaseGeneration: number;
    presenceSequence: number;
}> {
    const leaseExpiresAt = new Date(now.getTime() + EARLY_BIRD_LEASE_TTL_MS);
    const current = await authorizeFreeForAllStreamLease(leaseId, leaseGeneration, now);
    const nextPresence = presence?.state ?? current.presence;
    if (
        presenceSequence < current.presenceSequence
        || (presenceSequence === current.presenceSequence && nextPresence !== current.presence)
    ) throw new EarlyBirdLeaseRefreshRequiredError();
    const lease = await prisma.earlyBirdStreamLease.update({
        where: { id: current.id },
        data: {
            lastSeenAt: now,
            expiresAt: leaseExpiresAt,
            ...(presence && presenceSequence > current.presenceSequence ? {
                presence: nextPresence,
                macroRegion: presence.macroRegion,
                presenceUpdatedAt: now,
                presenceSequence,
            } : {}),
        },
    });
    const stream = await issuer.issue({
        accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
        leaseId: lease.id,
        leaseGeneration: lease.generation,
        issuedAt: now,
        leaseExpiresAt,
    });
    return {
        leaseExpiresAt,
        stream,
        serverNow: now,
        accessKind: 'free-for-all',
        quota: null,
        leaseGeneration: lease.generation,
        presenceSequence: lease.presenceSequence,
    };
}

/**
 * Server-only preflight for an operator-controlled Free-for-All transition.
 * It settles each personal account before evicting its active leases. Run in
 * bounded batches immediately before enabling the external FFA switch.
 */
export async function quiescePersonalListenerLeasesForFreeForAll(
    limit = 1_000,
): Promise<{ accountsSettled: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw new Error('limit is invalid');
    }
    const accounts = await prisma.$queryRaw<Array<{ accountId: string }>>`
        SELECT DISTINCT "account_id" AS "accountId"
        FROM "early_bird_stream_leases"
        WHERE "account_id" <> ${EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID}
          AND "evicted_at" IS NULL
          AND "expires_at" > clock_timestamp()
        ORDER BY "account_id"
        LIMIT ${limit}
    `;
    for (const { accountId } of accounts) {
        await withLockedQuotaTransaction(accountId, async (tx, now) => {
            const projection = await tx.earlyBirdMembershipProjection.findUnique({ where: { accountId } });
            await settleLockedEarlyBirdQuota({ tx, accountId, projection, now });
            await tx.earlyBirdStreamLease.updateMany({
                where: { accountId, evictedAt: null, expiresAt: { gt: now } },
                data: {
                    presence: 'IDLE',
                    presenceUpdatedAt: now,
                    evictedAt: now,
                },
            });
        });
    }
    return { accountsSettled: accounts.length };
}
