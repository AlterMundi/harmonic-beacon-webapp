import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const mock = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: mock }));
import { presenceTransaction } from '@/lib/presence-transaction';
const conflict = () => Object.assign(new Error('rollback'), { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict' } });
describe('presence transaction recovery', () => {
    beforeEach(() => vi.clearAllMocks());
    it('replays the whole callback with serializable isolation after an adapter commit rejection', async () => {
        const work = vi.fn();
        mock.$transaction.mockRejectedValueOnce(conflict()).mockResolvedValueOnce('accepted');
        await expect(presenceTransaction(work)).resolves.toBe('accepted');
        expect(mock.$transaction).toHaveBeenCalledTimes(2);
        for (const call of mock.$transaction.mock.calls) expect(call).toEqual([work, { isolationLevel: 'Serializable' }]);
    });
    it('bounds repeated Prisma write conflicts', async () => {
        const failure = new Prisma.PrismaClientKnownRequestError('rollback', { code: 'P2034', clientVersion: '7.9.1' });
        mock.$transaction.mockRejectedValue(failure);
        await expect(presenceTransaction(vi.fn())).rejects.toBe(failure);
        expect(mock.$transaction).toHaveBeenCalledTimes(5);
    });
    it.each([new Error('connection lost after commit'), new Error('TransactionWriteConflict'), Object.assign(new Error('constraint'), { name: 'DriverAdapterError', cause: { kind: 'UniqueConstraintViolation' } })])('never replays an unknown or ambiguous outcome', async error => {
        mock.$transaction.mockRejectedValue(error);
        await expect(presenceTransaction(vi.fn())).rejects.toBe(error);
        expect(mock.$transaction).toHaveBeenCalledTimes(1);
    });
});
