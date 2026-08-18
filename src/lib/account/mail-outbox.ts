import {
    createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID,
} from 'node:crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import {
    issueAccountActionTokenInTransaction,
    type AccountActionPurpose,
} from '@/lib/account/action-tokens';
import { deliverAccountActionEmail } from '@/lib/account/mail';

type Locale = 'es' | 'en';

function outboxKey(environment: NodeJS.ProcessEnv = process.env): Buffer {
    const encoded = environment.BEACON_ACCOUNT_MAIL_OUTBOX_KEY?.trim();
    if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
        throw new Error('BEACON_ACCOUNT_MAIL_OUTBOX_KEY must be an unpadded base64url 32-byte key');
    }
    const key = Buffer.from(encoded, 'base64url');
    if (key.length !== 32) throw new Error('BEACON_ACCOUNT_MAIL_OUTBOX_KEY has invalid length');
    return key;
}

function aad(job: { id: string; accountId: string; purpose: string }): Buffer {
    return Buffer.from(`${job.id}\0${job.accountId}\0${job.purpose}`, 'utf8');
}

export function sealAccountMailToken(token: string, job: {
    id: string; accountId: string; purpose: string;
}): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', outboxKey(), iv);
    cipher.setAAD(aad(job));
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function openAccountMailToken(value: string, job: {
    id: string; accountId: string; purpose: string;
}): string {
    const [iv, tag, encrypted, extra] = value.split('.');
    if (!iv || !tag || !encrypted || extra) throw new Error('Invalid sealed Account mail token');
    const decipher = createDecipheriv('aes-256-gcm', outboxKey(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(aad(job));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final(),
    ]).toString('utf8');
}

export function accountMailOutboxReady(environment: NodeJS.ProcessEnv = process.env): boolean {
    try { return outboxKey(environment).length === 32; } catch { return false; }
}

export async function queueAccountActionMail(input: {
    accountId: string;
    purpose: AccountActionPurpose;
    recipient: string;
    targetEmail?: string;
    locale: Locale;
    preserveUnexpiredPayload?: boolean;
}): Promise<void> {
    await prisma.$transaction(
        (transaction) => queueAccountActionMailInTransaction(transaction, input),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
}

export async function queueAccountActionMailInTransaction(
    transaction: Prisma.TransactionClient,
    input: {
        accountId: string;
        purpose: AccountActionPurpose;
        recipient: string;
        targetEmail?: string;
        locale: Locale;
        preserveUnexpiredPayload?: boolean;
    },
): Promise<void> {
        const now = new Date();
        // Serialize generations on the durable account row. A worker may keep
        // delivering its immutable generation while a newer request is queued;
        // neither side ever overwrites or deletes the other's payload.
        await transaction.$queryRaw`SELECT "id" FROM "early_bird_users" WHERE "id" = ${input.accountId} FOR UPDATE`;
        const existing = await transaction.beaconAccountMailOutbox.findFirst({
            where: { accountId: input.accountId, purpose: input.purpose },
            orderBy: { generation: 'desc' },
        });
        const preserve = input.preserveUnexpiredPayload && existing &&
            (!existing.deliveryAttemptedAt || Boolean(existing.sealedToken &&
                existing.tokenExpiresAt && existing.tokenExpiresAt > now));
        if (preserve) {
            // The credential trigger cannot see the browser locale. Before a
            // worker claims or seals the generation, enrich that same durable
            // intent without changing its identity or payload.
            if (!existing.lockedAt && !existing.sealedToken && !existing.deliveryAttemptedAt) {
                await transaction.beaconAccountMailOutbox.updateMany({
                    where: {
                        id: existing.id, generation: existing.generation,
                        lockedAt: null, sealedToken: null, deliveryAttemptedAt: null,
                    },
                    data: {
                        locale: input.locale,
                        recipient: input.recipient.trim().toLowerCase(),
                    },
                });
            }
            return;
        }
        await transaction.beaconAccountMailOutbox.create({
            data: {
                id: randomUUID(), accountId: input.accountId, purpose: input.purpose,
                recipient: input.recipient.trim().toLowerCase(),
                targetEmail: input.targetEmail?.trim().toLowerCase(), locale: input.locale,
                generation: (existing?.generation ?? 0) + 1,
            },
        });
}

export async function ensureVerificationMailQueued(email: string, locale: Locale): Promise<void> {
    const account = await prisma.earlyBirdUser.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: {
            id: true, email: true, emailVerified: true,
            identities: { where: { providerId: 'credential' }, select: { id: true }, take: 1 },
        },
    });
    if (!account || account.emailVerified || account.identities.length !== 1) return;
    await queueAccountActionMail({
        accountId: account.id, purpose: 'verify_email', recipient: account.email,
        locale, preserveUnexpiredPayload: true,
    });
}

async function preparePayload(job: {
    id: string; accountId: string; purpose: string; targetEmail: string | null;
    locale: string;
    sealedToken: string | null; tokenExpiresAt: Date | null; idempotencyKey: string | null;
    deliveryAttemptedAt: Date | null;
    generation: number;
}) {
    const now = new Date();
    return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "early_bird_users" WHERE "id" = ${job.accountId} FOR UPDATE`;
        const latest = await transaction.beaconAccountMailOutbox.findFirst({
            where: { accountId: job.accountId, purpose: job.purpose },
            orderBy: { generation: 'desc' }, select: { id: true, generation: true },
        });
        if (!latest || latest.id !== job.id || latest.generation !== job.generation) return null;
        if (job.sealedToken && job.tokenExpiresAt && job.tokenExpiresAt > now && job.idempotencyKey) {
            return {
                token: openAccountMailToken(job.sealedToken, job),
                expiresAt: job.tokenExpiresAt,
                idempotencyKey: job.idempotencyKey,
            };
        }
        if (job.deliveryAttemptedAt) return null;
        const issued = await issueAccountActionTokenInTransaction(transaction, {
            accountId: job.accountId,
            purpose: job.purpose as AccountActionPurpose,
            targetEmail: job.targetEmail ?? undefined,
            locale: job.locale === 'es' ? 'es' : 'en',
            now,
        });
        const idempotencyKey = createHash('sha256')
            .update(`listener-account-mail\0${job.id}\0${job.generation}`)
            .digest('hex');
        const persisted = await transaction.beaconAccountMailOutbox.updateMany({
            where: { id: job.id, generation: job.generation }, data: {
                sealedToken: sealAccountMailToken(issued.token, job),
                tokenExpiresAt: issued.expiresAt, idempotencyKey,
            },
        });
        if (persisted.count !== 1) throw new Error('Account mail generation changed');
        return { ...issued, idempotencyKey };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export type AccountMailOutboxBatch = {
    attempted: number;
    delivered: number;
    failed: number;
};

export async function processAccountMailOutboxBatch(limit = 10): Promise<AccountMailOutboxBatch> {
    const now = new Date();
    const jobs = await prisma.beaconAccountMailOutbox.findMany({
        where: {
            nextAttemptAt: { lte: now },
            OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - 5 * 60_000) } }],
        },
        orderBy: { nextAttemptAt: 'asc' }, take: Math.max(1, Math.min(limit, 50)),
    });
    let delivered = 0;
    let attempted = 0;
    let failed = 0;
    for (const job of jobs) {
        const claimed = await prisma.beaconAccountMailOutbox.updateMany({
            where: {
                id: job.id, generation: job.generation,
                OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - 5 * 60_000) } }],
            }, data: { lockedAt: now },
        });
        if (claimed.count !== 1) continue;
        attempted += 1;
        try {
            const payload = await preparePayload(job);
            if (!payload) {
                await prisma.beaconAccountMailOutbox.deleteMany({
                    where: { id: job.id, generation: job.generation },
                });
                continue;
            }
            const attempting = await prisma.beaconAccountMailOutbox.updateMany({
                where: { id: job.id, generation: job.generation },
                data: { deliveryAttemptedAt: new Date() },
            });
            if (attempting.count !== 1) continue;
            await deliverAccountActionEmail({
                recipient: job.recipient,
                purpose: job.purpose as AccountActionPurpose,
                token: payload.token,
                expiresAt: payload.expiresAt,
                locale: job.locale === 'es' ? 'es' : 'en',
                idempotencyKey: payload.idempotencyKey,
            });
            const deleted = await prisma.beaconAccountMailOutbox.deleteMany({
                where: { id: job.id, generation: job.generation },
            });
            delivered += deleted.count;
        } catch {
            failed += 1;
            const attempts = job.attempts + 1;
            await prisma.beaconAccountMailOutbox.updateMany({
                where: { id: job.id, generation: job.generation },
                data: {
                    attempts, lockedAt: null,
                    nextAttemptAt: new Date(Date.now() + Math.min(15 * 60_000, 2 ** Math.min(attempts, 9) * 1_000)),
                },
            });
        }
    }
    return { attempted, delivered, failed };
}

export async function processVerificationMailOutbox(limit = 10): Promise<number> {
    return (await processAccountMailOutboxBatch(limit)).delivered;
}

export async function accountMailOutboxMetrics(now = new Date()): Promise<{
    pendingCount: number;
    oldestPendingSeconds: number;
}> {
    const [pendingCount, oldest] = await Promise.all([
        prisma.beaconAccountMailOutbox.count(),
        prisma.beaconAccountMailOutbox.aggregate({ _min: { createdAt: true } }),
    ]);
    return {
        pendingCount,
        oldestPendingSeconds: oldest._min.createdAt
            ? Math.max(0, Math.floor((now.getTime() - oldest._min.createdAt.getTime()) / 1_000))
            : 0,
    };
}
