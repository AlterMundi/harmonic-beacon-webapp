import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    ListenerWithdrawalConflictError,
    ListenerWithdrawalRateLimitError,
    listenerWithdrawalNetworkBucketKey,
    parseListenerWithdrawalInput,
    submitListenerWithdrawal,
} from '../consumer-withdrawal';

const databaseUrl = process.env.LISTENER_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const postgres = databaseUrl ? describe : describe.skip;
let prisma: PrismaClient;
const suffix = randomUUID();
const secret = `postgres-withdrawal-${suffix}`;
const idempotencyKey = randomUUID();
const rateIdempotencyKeys = Array.from({ length: 9 }, () => randomUUID());

function request(email = `withdrawal-${suffix}@example.invalid`) {
    return parseListenerWithdrawalInput({
        email,
        idempotencyKey,
        locale: 'es',
        provider: 'PAYPAL',
        purchaseDate: '',
    });
}

postgres('Listener withdrawal PostgreSQL queue', () => {
    beforeAll(async () => {
        ({ prisma } = await import('@/lib/db'));
    });

    afterAll(async () => {
        await prisma.listenerWithdrawalRequest.deleteMany({
            where: { idempotencyKey: { in: [idempotencyKey, ...rateIdempotencyKeys] } },
        });
        await prisma.listenerWithdrawalThrottle.deleteMany({
            where: {
                key: {
                    in: [
                        listenerWithdrawalNetworkBucketKey(suffix, secret),
                        listenerWithdrawalNetworkBucketKey(`rate-${suffix}`, secret),
                    ],
                },
            },
        });
        await prisma.$disconnect();
    });

    it('converges concurrent exact submissions to one durable request and receipt', async () => {
        const input = { request: request(), networkIdentity: suffix, secret };
        const results = await Promise.all([
            submitListenerWithdrawal(input),
            submitListenerWithdrawal(input),
        ]);
        expect(new Set(results.map((result) => result.receiptCode))).toHaveLength(1);
        expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
        expect(await prisma.listenerWithdrawalRequest.count({ where: { idempotencyKey } })).toBe(1);
        const persisted = await prisma.listenerWithdrawalRequest.findUniqueOrThrow({
            where: { idempotencyKey },
        });
        expect(persisted.receiptDigest).toMatch(/^[0-9a-f]{64}$/);
        expect('receiptCode' in persisted).toBe(false);
    });

    it('rejects conflicting reuse and enforces ordered processing fields', async () => {
        await expect(submitListenerWithdrawal({
            request: request(`changed-${suffix}@example.invalid`),
            networkIdentity: suffix,
            secret,
        })).rejects.toBeInstanceOf(ListenerWithdrawalConflictError);
        await expect(prisma.listenerWithdrawalRequest.update({
            where: { idempotencyKey },
            data: { status: 'RESOLVED' },
        })).rejects.toThrow();
    });

    it('enforces the durable network abuse bucket without account lookups', async () => {
        for (const [index, rateKey] of rateIdempotencyKeys.entries()) {
            const candidate = parseListenerWithdrawalInput({
                email: `rate-${index}-${suffix}@example.invalid`,
                idempotencyKey: rateKey,
                locale: 'en',
                provider: 'OTHER',
                purchaseDate: '',
            });
            const submission = submitListenerWithdrawal({
                request: candidate,
                networkIdentity: `rate-${suffix}`,
                secret,
            });
            if (index < 8) await expect(submission).resolves.toMatchObject({ replayed: false });
            else await expect(submission).rejects.toBeInstanceOf(ListenerWithdrawalRateLimitError);
        }
        expect(await prisma.listenerWithdrawalRequest.count({
            where: { idempotencyKey: { in: rateIdempotencyKeys } },
        })).toBe(8);
    });
});
