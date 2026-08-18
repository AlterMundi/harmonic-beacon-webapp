import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const state = {
        deleted: false,
        job: {} as Record<string, unknown>,
    };
    const issue = vi.fn();
    const deliver = vi.fn();
    const create = vi.fn();
    const findFirst = vi.fn(async () => ({
        id: state.job.id,
        generation: state.job.generation,
    }));
    const updateMany = vi.fn(async (input: { data?: Record<string, unknown> }) => {
        if (input.data) Object.assign(state.job, input.data);
        return { count: 1 };
    });
    const deleteMany = vi.fn(async () => {
        state.deleted = true;
        return { count: 1 };
    });
    const transactionClient = {
        $queryRaw: vi.fn(async () => [{ id: state.job.accountId }]),
        beaconAccountMailOutbox: { findFirst, create, updateMany, deleteMany },
    };
    return {
        state, issue, deliver, create, findFirst, updateMany, deleteMany,
        transactionClient,
        transaction: vi.fn(async (callback: (transaction: typeof transactionClient) => unknown) =>
            callback(transactionClient)),
        jobs: vi.fn(async () => state.deleted ? [] : [{ ...state.job }]),
    };
});

vi.mock('@/lib/db', () => ({
    prisma: {
        $transaction: mocks.transaction,
        beaconAccountMailOutbox: {
            findMany: mocks.jobs,
            updateMany: mocks.updateMany,
            deleteMany: mocks.deleteMany,
        },
    },
}));
vi.mock('@/lib/account/action-tokens', () => ({
    issueAccountActionTokenInTransaction: mocks.issue,
}));
vi.mock('@/lib/account/mail', () => ({ deliverAccountActionEmail: mocks.deliver }));

import {
    processVerificationMailOutbox,
    queueAccountActionMail,
} from '../mail-outbox';

describe('durable Account mail outbox', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.BEACON_ACCOUNT_MAIL_OUTBOX_KEY = Buffer.alloc(32, 7).toString('base64url');
        mocks.state.deleted = false;
        mocks.state.job = {
            id: '9ffed47f-af68-436b-b38d-2f351b27dcb1',
            accountId: 'account', purpose: 'reset_password', recipient: 'listener@example.invalid',
            targetEmail: null, locale: 'es', attempts: 0, generation: 3,
            sealedToken: null, tokenExpiresAt: null, idempotencyKey: null,
            deliveryAttemptedAt: null, lockedAt: null, nextAttemptAt: new Date(0),
        };
        mocks.findFirst.mockImplementation(async () => ({
            id: mocks.state.job.id,
            generation: mocks.state.job.generation,
        }));
        mocks.updateMany.mockImplementation(async (input: { data?: Record<string, unknown> }) => {
            if (input.data) Object.assign(mocks.state.job, input.data);
            return { count: 1 };
        });
        mocks.deleteMany.mockImplementation(async () => {
            mocks.state.deleted = true;
            return { count: 1 };
        });
        mocks.jobs.mockImplementation(async () =>
            mocks.state.deleted ? [] : [{ ...mocks.state.job }]);
        mocks.issue.mockResolvedValue({
            token: 'opaque-token-that-remains-valid-across-retries-1234',
            expiresAt: new Date(Date.now() + 60_000),
        });
        mocks.create.mockResolvedValue({});
    });

    it('retries an ambiguous delivery with the same sealed token and 64-hex key', async () => {
        mocks.deliver.mockRejectedValueOnce(new Error('accepted response was lost'))
            .mockResolvedValueOnce(undefined);

        await expect(processVerificationMailOutbox()).resolves.toBe(0);
        const firstDelivery = mocks.deliver.mock.calls[0]?.[0];
        expect(firstDelivery.token).toBe('opaque-token-that-remains-valid-across-retries-1234');
        expect(firstDelivery.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
        expect(mocks.state.job.sealedToken).toEqual(expect.any(String));
        expect(mocks.state.job.sealedToken).not.toContain(firstDelivery.token);

        await expect(processVerificationMailOutbox()).resolves.toBe(1);
        expect(mocks.issue).toHaveBeenCalledOnce();
        expect(mocks.deliver).toHaveBeenCalledTimes(2);
        expect(mocks.deliver.mock.calls[1]?.[0]).toEqual(firstDelivery);
        expect(mocks.deleteMany).toHaveBeenLastCalledWith({
            where: { id: mocks.state.job.id, generation: 3 },
        });
    });

    it('does not let a newer queued request overwrite a claimed generation', async () => {
        mocks.state.job.lockedAt = new Date();
        mocks.findFirst.mockResolvedValueOnce({
            id: mocks.state.job.id,
            generation: mocks.state.job.generation,
        });

        await queueAccountActionMail({
            accountId: 'account', purpose: 'reset_password',
            recipient: 'listener@example.invalid', locale: 'en',
        });

        expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            accountId: 'account', purpose: 'reset_password', generation: 4,
        }) });
        expect(mocks.state.job.generation).toBe(3);
        expect(mocks.state.job.lockedAt).toEqual(expect.any(Date));
    });

    it('drops a superseded generation before issuing or sending a token', async () => {
        mocks.findFirst.mockResolvedValue({ id: 'newer-job', generation: 4 });

        await expect(processVerificationMailOutbox()).resolves.toBe(0);

        expect(mocks.issue).not.toHaveBeenCalled();
        expect(mocks.deliver).not.toHaveBeenCalled();
        expect(mocks.deleteMany).toHaveBeenCalledWith({
            where: { id: mocks.state.job.id, generation: 3 },
        });
    });
});
