import { createHash, createHmac } from 'node:crypto';

import { Prisma, type ListenerWithdrawalProvider } from '@prisma/client';

import { prisma } from '@/lib/db';

const RATE_WINDOW_MS = 60 * 60 * 1_000;
const RATE_WINDOW_MAX = 8;
const RATE_RETENTION_MS = 48 * 60 * 60 * 1_000;
const RECEIPT_HEX_LENGTH = 30;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const IDEMPOTENCY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ListenerWithdrawalInput = {
    email: string;
    provider: ListenerWithdrawalProvider;
    purchaseDate: Date | null;
    locale: 'es' | 'en';
    idempotencyKey: string;
};

export type ListenerWithdrawalReceipt = {
    receiptCode: string;
    receivedAt: Date;
    replayed: boolean;
};

export class ListenerWithdrawalInputError extends Error {
    constructor() {
        super('Invalid withdrawal request');
        this.name = 'ListenerWithdrawalInputError';
    }
}

export class ListenerWithdrawalConflictError extends Error {
    constructor() {
        super('Withdrawal request idempotency conflict');
        this.name = 'ListenerWithdrawalConflictError';
    }
}

export class ListenerWithdrawalRateLimitError extends Error {
    constructor() {
        super('Withdrawal request rate limit reached');
        this.name = 'ListenerWithdrawalRateLimitError';
    }
}

export function listenerWithdrawalSecret(
    environment: Record<string, string | undefined> = process.env,
): string | null {
    const value = environment.LISTENER_WITHDRAWAL_SECRET;
    return value && value.length >= 32 ? value : null;
}

function normalizeEmail(value: unknown): string {
    if (typeof value !== 'string') throw new ListenerWithdrawalInputError();
    const email = value.trim().toLowerCase();
    if (email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
        throw new ListenerWithdrawalInputError();
    }
    return email;
}

function normalizeProvider(value: unknown): ListenerWithdrawalProvider {
    if (value === 'PAYPAL' || value === 'MERCADO_PAGO' || value === 'OTHER') return value;
    throw new ListenerWithdrawalInputError();
}

function normalizePurchaseDate(value: unknown, now: Date): Date | null {
    if (value === '' || value === null) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new ListenerWithdrawalInputError();
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new ListenerWithdrawalInputError();
    }
    const tomorrowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    if (date.getTime() < Date.UTC(2000, 0, 1) || date.getTime() >= tomorrowUtc) {
        throw new ListenerWithdrawalInputError();
    }
    return date;
}

export function parseListenerWithdrawalInput(input: unknown, now = new Date()): ListenerWithdrawalInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new ListenerWithdrawalInputError();
    }
    const record = input as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const expected = ['email', 'idempotencyKey', 'locale', 'provider', 'purchaseDate'].sort();
    if (keys.join('\0') !== expected.join('\0')) {
        throw new ListenerWithdrawalInputError();
    }
    if (record.locale !== 'es' && record.locale !== 'en') throw new ListenerWithdrawalInputError();
    if (typeof record.idempotencyKey !== 'string' || !IDEMPOTENCY_PATTERN.test(record.idempotencyKey)) {
        throw new ListenerWithdrawalInputError();
    }
    return {
        email: normalizeEmail(record.email),
        provider: normalizeProvider(record.provider),
        purchaseDate: normalizePurchaseDate(record.purchaseDate, now),
        locale: record.locale,
        idempotencyKey: record.idempotencyKey.toLowerCase(),
    };
}

function canonicalRequest(input: ListenerWithdrawalInput): string {
    return JSON.stringify({
        email: input.email,
        idempotencyKey: input.idempotencyKey,
        locale: input.locale,
        provider: input.provider,
        purchaseDate: input.purchaseDate?.toISOString().slice(0, 10) ?? null,
    });
}

export function listenerWithdrawalRequestHash(input: ListenerWithdrawalInput): string {
    return createHash('sha256').update(canonicalRequest(input), 'utf8').digest('hex');
}

export function listenerWithdrawalReceiptCode(idempotencyKey: string): string {
    // The UUID supplies 122 random bits. A namespaced one-way derivation keeps
    // the receipt opaque and replayable even when the rate-limit secret rotates.
    const opaque = createHash('sha256')
        .update(`listener-withdrawal-receipt\n${idempotencyKey}`, 'utf8')
        .digest('hex')
        .slice(0, RECEIPT_HEX_LENGTH)
        .toUpperCase();
    return `HBW-${opaque}`;
}

export function listenerWithdrawalReceiptDigest(receiptCode: string): string {
    return createHash('sha256').update(receiptCode, 'utf8').digest('hex');
}

export function listenerWithdrawalNetworkBucketKey(networkIdentity: string, secret: string): string {
    const digest = createHmac('sha256', secret)
        .update(`listener-withdrawal-network\n${networkIdentity}`, 'utf8')
        .digest('hex');
    return `network:${digest}`;
}

async function consumeNetworkBucket(
    tx: Prisma.TransactionClient,
    key: string,
    now: Date,
): Promise<void> {
    const current = await tx.listenerWithdrawalThrottle.upsert({
        where: { key },
        create: { key, windowStartedAt: now, attempts: 0 },
        update: {},
    });
    if (current.blockedUntil && current.blockedUntil > now) throw new ListenerWithdrawalRateLimitError();
    const windowEnd = new Date(current.windowStartedAt.getTime() + RATE_WINDOW_MS);
    if (windowEnd <= now) {
        await tx.listenerWithdrawalThrottle.update({
            where: { key },
            data: { windowStartedAt: now, attempts: 1, blockedUntil: null },
        });
        return;
    }
    if (current.attempts >= RATE_WINDOW_MAX) {
        await tx.listenerWithdrawalThrottle.update({
            where: { key },
            data: { blockedUntil: windowEnd },
        });
        throw new ListenerWithdrawalRateLimitError();
    }
    await tx.listenerWithdrawalThrottle.update({
        where: { key },
        data: { attempts: { increment: 1 } },
    });
}

function isPrismaCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
        && (error as { code?: unknown }).code === code;
}

export async function submitListenerWithdrawal(input: {
    request: ListenerWithdrawalInput;
    networkIdentity: string;
    secret: string;
    now?: Date;
}): Promise<ListenerWithdrawalReceipt> {
    const now = input.now ?? new Date();
    const requestHash = listenerWithdrawalRequestHash(input.request);
    const receiptCode = listenerWithdrawalReceiptCode(input.request.idempotencyKey);
    const receiptDigest = listenerWithdrawalReceiptDigest(receiptCode);
    const bucketKey = listenerWithdrawalNetworkBucketKey(input.networkIdentity, input.secret);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await prisma.$transaction(async (tx) => {
                const existing = await tx.listenerWithdrawalRequest.findUnique({
                    where: { idempotencyKey: input.request.idempotencyKey },
                    select: { requestHash: true, createdAt: true },
                });
                if (existing) {
                    if (existing.requestHash !== requestHash) throw new ListenerWithdrawalConflictError();
                    return { receiptCode, receivedAt: existing.createdAt, replayed: true };
                }

                await tx.listenerWithdrawalThrottle.deleteMany({
                    where: { updatedAt: { lt: new Date(now.getTime() - RATE_RETENTION_MS) } },
                });
                await consumeNetworkBucket(tx, bucketKey, now);
                const created = await tx.listenerWithdrawalRequest.create({
                    data: {
                        receiptDigest,
                        receiptLastFour: receiptCode.slice(-4),
                        idempotencyKey: input.request.idempotencyKey,
                        requestHash,
                        contactEmail: input.request.email,
                        provider: input.request.provider,
                        purchaseDate: input.request.purchaseDate,
                        locale: input.request.locale,
                    },
                    select: { createdAt: true },
                });
                return { receiptCode, receivedAt: created.createdAt, replayed: false };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (isPrismaCode(error, 'P2034') && attempt < 2) continue;
            if (isPrismaCode(error, 'P2002')) {
                const existing = await prisma.listenerWithdrawalRequest.findUnique({
                    where: { idempotencyKey: input.request.idempotencyKey },
                    select: { requestHash: true, createdAt: true },
                });
                if (existing?.requestHash === requestHash) {
                    return { receiptCode, receivedAt: existing.createdAt, replayed: true };
                }
                throw new ListenerWithdrawalConflictError();
            }
            throw error;
        }
    }
    throw new Error('unreachable withdrawal serialization retry');
}

export function listenerWithdrawalNetworkIdentity(request: Request): string {
    const direct = request.headers.get('x-real-ip')?.trim();
    const forwarded = request.headers.get('x-forwarded-for')
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .at(-1);
    const address = direct || forwarded || 'unavailable';
    return address.length <= 128 ? address : 'unavailable';
}
