import { createHmac } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { listeningAccessDecision } from './access';

export const EARLY_BIRD_MAX_STREAM_DEVICES = 2;
export const EARLY_BIRD_LEASE_TTL_MS = 3 * 60 * 1000;
export const EARLY_BIRD_ORIGIN_MAX_SIGNATURE_TTL_SECONDS = 10 * 60;
export const EARLY_BIRD_ORIGIN_MANIFEST_TTL_SECONDS = 60;
export const EARLY_BIRD_LEASE_MANIFEST_PATH = '/api/early-birds/stream/manifest';
export const EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID = 'early-birds-free-for-all';

const EARLY_BIRD_FREE_FOR_ALL_ACCOUNT = {
    id: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
    name: 'Public Listener',
    email: 'public-listener@free.invalid',
    emailVerified: false,
} as const;

export type StreamUrlIssueRequest = {
    accountId: string;
    leaseId: string;
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
        const query = new URLSearchParams({ leaseId: request.leaseId });
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
    leaseExpiresAt: Date;
    evictedLeaseId: string | null;
    stream: StreamUrlGrant;
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

function cappedLeaseExpiry(now: Date, allowedUntil: Date | null): Date {
    const ttlExpiry = new Date(now.getTime() + EARLY_BIRD_LEASE_TTL_MS);
    return allowedUntil && allowedUntil < ttlExpiry ? allowedUntil : ttlExpiry;
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
    now = new Date(),
) {
    const [projection, schedule, welcome, lease] = await Promise.all([
        prisma.earlyBirdMembershipProjection.findUnique({ where: { accountId } }),
        prisma.earlyBirdFreeSchedule.findUnique({ where: { accountId } }),
        prisma.earlyBirdWelcomeAccess.findUnique({ where: { accountId } }),
        prisma.earlyBirdStreamLease.findFirst({ where: { id: leaseId, accountId } }),
    ]);
    if (!listeningAccessDecision(projection, schedule, now, welcome).allowed) {
        throw new EarlyBirdAccessDeniedError();
    }
    if (!lease) throw new EarlyBirdLeaseInactiveError('missing');
    if (lease.evictedAt !== null) throw new EarlyBirdLeaseInactiveError('evicted');
    if (lease.expiresAt <= now) throw new EarlyBirdLeaseInactiveError('expired');
    return lease;
}

export async function acquireEarlyBirdStreamLease(
    accountId: string,
    deviceId: string,
    now = new Date(),
    issuer = earlyBirdStreamUrlIssuer(),
    evictOldest = true,
): Promise<LeaseAcquisition> {
    const deviceDigest = earlyBirdDeviceDigest(deviceId);

    const lease = await prisma.$transaction(async (tx) => {
        const accountRows = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "early_bird_users" WHERE "id" = ${accountId} FOR UPDATE`,
        );
        if (accountRows.length !== 1) throw new EarlyBirdAccessDeniedError();

        const [projection, schedule, welcome] = await Promise.all([
            tx.earlyBirdMembershipProjection.findUnique({ where: { accountId } }),
            tx.earlyBirdFreeSchedule.findUnique({ where: { accountId } }),
            tx.earlyBirdWelcomeAccess.findUnique({ where: { accountId } }),
        ]);
        const access = listeningAccessDecision(projection, schedule, now, welcome);
        if (!access.allowed) {
            throw new EarlyBirdAccessDeniedError();
        }
        const leaseExpiresAt = cappedLeaseExpiry(now, access.allowedUntil);
        if (leaseExpiresAt <= now) throw new EarlyBirdAccessDeniedError();

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
        if (!evictOldest && overflow > 0) throw new EarlyBirdDeviceCapacityError();
        const evicted = active.slice(0, overflow);
        if (evicted.length > 0) {
            await tx.earlyBirdStreamLease.updateMany({
                where: { id: { in: evicted.map(({ id }) => id) } },
                data: { evictedAt: now },
            });
        }

        // A prepare lease may decode/prefetch for iOS, but it must always lose
        // an eviction contest against a device on which the person pressed play.
        const prioritySeenAt = evictOldest ? now : new Date(0);
        const current = previous
            ? await tx.earlyBirdStreamLease.update({
                where: { id: previous.id },
                data: { createdAt: now, lastSeenAt: prioritySeenAt, expiresAt: leaseExpiresAt, evictedAt: null },
            })
            : await tx.earlyBirdStreamLease.create({
                data: { accountId, deviceDigest, lastSeenAt: prioritySeenAt, expiresAt: leaseExpiresAt },
            });
        return { current, evictedLeaseId: evicted[0]?.id ?? null, leaseExpiresAt };
    });

    try {
        const stream = await issuer.issue({
            accountId,
            leaseId: lease.current.id,
            issuedAt: now,
            leaseExpiresAt: lease.leaseExpiresAt,
        });
        return {
            leaseId: lease.current.id,
            leaseExpiresAt: lease.leaseExpiresAt,
            evictedLeaseId: lease.evictedLeaseId,
            stream,
        };
    } catch (error) {
        await prisma.earlyBirdStreamLease.updateMany({
            where: { id: lease.current.id, accountId },
            data: { evictedAt: now },
        });
        throw error;
    }
}

export function prepareEarlyBirdStreamLease(
    accountId: string,
    deviceId: string,
    now = new Date(),
    issuer = earlyBirdStreamUrlIssuer(),
): Promise<LeaseAcquisition> {
    return acquireEarlyBirdStreamLease(accountId, deviceId, now, issuer, false);
}

export async function heartbeatEarlyBirdStreamLease(
    accountId: string,
    leaseId: string,
    now = new Date(),
    issuer = earlyBirdStreamUrlIssuer(),
    refreshPriority = true,
): Promise<{ leaseExpiresAt: Date; stream: StreamUrlGrant }> {
    const lease = await prisma.$transaction(async (tx) => {
        const [projection, schedule, welcome] = await Promise.all([
            tx.earlyBirdMembershipProjection.findUnique({ where: { accountId } }),
            tx.earlyBirdFreeSchedule.findUnique({ where: { accountId } }),
            tx.earlyBirdWelcomeAccess.findUnique({ where: { accountId } }),
        ]);
        const access = listeningAccessDecision(projection, schedule, now, welcome);
        if (!access.allowed) {
            throw new EarlyBirdAccessDeniedError();
        }
        const leaseExpiresAt = cappedLeaseExpiry(now, access.allowedUntil);
        if (leaseExpiresAt <= now) throw new EarlyBirdAccessDeniedError();
        const current = await tx.earlyBirdStreamLease.findFirst({
            where: { id: leaseId, accountId },
        });
        if (!current) throw new EarlyBirdLeaseInactiveError('missing');
        if (current.evictedAt !== null) throw new EarlyBirdLeaseInactiveError('evicted');
        if (current.expiresAt <= now) throw new EarlyBirdLeaseInactiveError('expired');
        const updated = await tx.earlyBirdStreamLease.update({
            where: { id: current.id },
            data: refreshPriority
                ? { lastSeenAt: now, expiresAt: leaseExpiresAt }
                : { expiresAt: leaseExpiresAt },
        });
        return { updated, leaseExpiresAt };
    });

    const stream = await issuer.issue({
        accountId,
        leaseId: lease.updated.id,
        issuedAt: now,
        leaseExpiresAt: lease.leaseExpiresAt,
    });
    return { leaseExpiresAt: lease.leaseExpiresAt, stream };
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
        },
        update: {
            createdAt: now,
            lastSeenAt: now,
            expiresAt: leaseExpiresAt,
            evictedAt: null,
        },
    });

    try {
        const stream = await issuer.issue({
            accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
            leaseId: lease.id,
            issuedAt: now,
            leaseExpiresAt,
        });
        return {
            leaseId: lease.id,
            leaseExpiresAt,
            evictedLeaseId: null,
            stream,
        };
    } catch (error) {
        await prisma.earlyBirdStreamLease.updateMany({
            where: { id: lease.id, accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID },
            data: { evictedAt: now },
        });
        throw error;
    }
}

export async function authorizeFreeForAllStreamLease(
    leaseId: string,
    now = new Date(),
) {
    const lease = await prisma.earlyBirdStreamLease.findFirst({
        where: { id: leaseId, accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID },
    });
    if (!lease) throw new EarlyBirdLeaseInactiveError('missing');
    if (lease.evictedAt !== null) throw new EarlyBirdLeaseInactiveError('evicted');
    if (lease.expiresAt <= now) throw new EarlyBirdLeaseInactiveError('expired');
    return lease;
}

export async function heartbeatFreeForAllStreamLease(
    leaseId: string,
    now = new Date(),
    issuer = earlyBirdStreamUrlIssuer(),
): Promise<{ leaseExpiresAt: Date; stream: StreamUrlGrant }> {
    const leaseExpiresAt = new Date(now.getTime() + EARLY_BIRD_LEASE_TTL_MS);
    const current = await authorizeFreeForAllStreamLease(leaseId, now);
    const lease = await prisma.earlyBirdStreamLease.update({
        where: { id: current.id },
        data: { lastSeenAt: now, expiresAt: leaseExpiresAt },
    });
    const stream = await issuer.issue({
        accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
        leaseId: lease.id,
        issuedAt: now,
        leaseExpiresAt,
    });
    return { leaseExpiresAt, stream };
}
