import { createHash, randomBytes } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { ACCOUNT_EMAIL_TTL_SECONDS } from '@/lib/account/config';

export type AccountActionPurpose = 'verify_email' | 'reset_password' | 'change_email';

export function digestAccountActionToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Cheap preflight before expensive password hashing; mutation still rechecks atomically. */
export async function accountActionTokenCanProceed(input: {
    token: string;
    purpose: AccountActionPurpose;
    now?: Date;
}): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(input.token)) return false;
    const record = await prisma.beaconAccountActionToken.findUnique({
        where: { tokenDigest: digestAccountActionToken(input.token) },
        select: { purpose: true, expiresAt: true, consumedAt: true },
    });
    return Boolean(record && record.purpose === input.purpose && !record.consumedAt &&
        record.expiresAt > (input.now ?? new Date()));
}

export async function issueAccountActionToken(input: {
    accountId: string;
    purpose: AccountActionPurpose;
    targetEmail?: string;
    locale?: 'es' | 'en';
    now?: Date;
}): Promise<{ token: string; expiresAt: Date }> {
    return prisma.$transaction(
        (transaction) => issueAccountActionTokenInTransaction(transaction, input),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
}

export async function issueAccountActionTokenInTransaction(inputTransaction: Prisma.TransactionClient, input: {
    accountId: string;
    purpose: AccountActionPurpose;
    targetEmail?: string;
    locale?: 'es' | 'en';
    now?: Date;
}): Promise<{ token: string; expiresAt: Date }> {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + ACCOUNT_EMAIL_TTL_SECONDS * 1_000);
    const token = randomBytes(32).toString('base64url');
    const tokenDigest = digestAccountActionToken(token);
    await inputTransaction.beaconAccountActionToken.updateMany({
            where: {
                accountId: input.accountId,
                purpose: input.purpose,
                consumedAt: null,
            },
            data: { consumedAt: now },
        });
    await inputTransaction.beaconAccountActionToken.create({
            data: {
                tokenDigest,
                accountId: input.accountId,
                purpose: input.purpose,
                targetEmail: input.targetEmail?.trim().toLowerCase(),
                locale: input.locale === 'es' ? 'es' : 'en',
                expiresAt,
            },
    });
    return { token, expiresAt };
}

/** Atomically consumes a token. It can never be replayed, even concurrently. */
export async function consumeAccountActionToken(input: {
    token: string;
    purpose: AccountActionPurpose;
    now?: Date;
}): Promise<{ accountId: string; targetEmail: string | null } | null> {
    return consumeAccountActionTokenWith(input, async (_transaction, action) => action);
}

export async function consumeAccountActionTokenWith<T>(input: {
    token: string;
    purpose: AccountActionPurpose;
    now?: Date;
}, apply: (
    transaction: Prisma.TransactionClient,
    action: { accountId: string; targetEmail: string | null },
) => Promise<T>): Promise<T | null> {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(input.token)) return null;
    const now = input.now ?? new Date();
    return prisma.$transaction(async (transaction) => {
        const record = await transaction.beaconAccountActionToken.findUnique({
            where: { tokenDigest: digestAccountActionToken(input.token) },
        });
        if (!record || record.purpose !== input.purpose || record.consumedAt ||
            record.expiresAt <= now) return null;
        const consumed = await transaction.beaconAccountActionToken.updateMany({
            where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
            data: { consumedAt: now },
        });
        if (consumed.count !== 1) return null;
        return apply(transaction, {
            accountId: record.accountId,
            targetEmail: record.targetEmail,
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
