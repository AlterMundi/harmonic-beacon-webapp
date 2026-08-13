import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    ListenerWithdrawalConflictError,
    ListenerWithdrawalRateLimitError,
    LISTENER_WITHDRAWAL_GLOBAL_BUCKET_KEY,
    listenerWithdrawalEmailBucketKey,
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
const emailRateIdempotencyKeys = Array.from({ length: 6 }, () => randomUUID());
const globalRateIdempotencyKey = randomUUID();

function request(email = `withdrawal-${suffix}@example.invalid`) {
    return parseListenerWithdrawalInput({
        email,
        idempotencyKey,
        locale: 'es',
        provider: 'PAYPAL',
        purchaseDate: '',
        requestKind: 'WITHDRAWAL',
    });
}

postgres('Listener withdrawal PostgreSQL queue', () => {
    beforeAll(async () => {
        ({ prisma } = await import('@/lib/db'));
    });

    afterAll(async () => {
        await prisma.listenerWithdrawalRequest.deleteMany({
            where: { idempotencyKey: { in: [
                idempotencyKey,
                globalRateIdempotencyKey,
                ...rateIdempotencyKeys,
                ...emailRateIdempotencyKeys,
            ] } },
        });
        await prisma.listenerWithdrawalThrottle.deleteMany({
            where: {
                key: {
                    in: [
                        listenerWithdrawalNetworkBucketKey(suffix, secret),
                        listenerWithdrawalNetworkBucketKey(`rate-${suffix}`, secret),
                        listenerWithdrawalEmailBucketKey(`withdrawal-${suffix}@example.invalid`, secret),
                        listenerWithdrawalEmailBucketKey(`shared-${suffix}@example.invalid`, secret),
                        LISTENER_WITHDRAWAL_GLOBAL_BUCKET_KEY,
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
                requestKind: 'WITHDRAWAL',
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

    it('limits one normalized email across distributed network identities', async () => {
        for (const [index, key] of emailRateIdempotencyKeys.entries()) {
            const candidate = parseListenerWithdrawalInput({
                email: ` Shared-${suffix}@Example.Invalid `,
                idempotencyKey: key,
                locale: 'en',
                provider: 'OTHER',
                purchaseDate: '',
                requestKind: 'SERVICE_CANCELLATION',
            });
            const submission = submitListenerWithdrawal({
                request: candidate,
                networkIdentity: `distributed-${index}-${suffix}`,
                secret,
            });
            if (index < 5) await expect(submission).resolves.toMatchObject({ replayed: false });
            else await expect(submission).rejects.toBeInstanceOf(ListenerWithdrawalRateLimitError);
        }
        expect(await prisma.listenerWithdrawalThrottle.findUnique({
            where: { key: listenerWithdrawalEmailBucketKey(`shared-${suffix}@example.invalid`, secret) },
        })).toMatchObject({ attempts: 5 });
    });

    it('enforces the fixed global hourly cap before accepting another request', async () => {
        await prisma.listenerWithdrawalThrottle.upsert({
            where: { key: LISTENER_WITHDRAWAL_GLOBAL_BUCKET_KEY },
            create: {
                key: LISTENER_WITHDRAWAL_GLOBAL_BUCKET_KEY,
                windowStartedAt: new Date(),
                attempts: 200,
            },
            update: { windowStartedAt: new Date(), attempts: 200 },
        });
        const candidate = parseListenerWithdrawalInput({
            email: `global-${suffix}@example.invalid`,
            idempotencyKey: globalRateIdempotencyKey,
            locale: 'es',
            provider: 'PAYPAL',
            purchaseDate: '',
            requestKind: 'WITHDRAWAL',
        });
        await expect(submitListenerWithdrawal({
            request: candidate,
            networkIdentity: `global-${suffix}`,
            secret,
        })).rejects.toBeInstanceOf(ListenerWithdrawalRateLimitError);
    });
});
