import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
    accountPrismaClient,
    withAccountEmailSignupProfile,
} from '@/lib/account/signup-profile';

describe('private email-signup profile persistence', () => {
    it('adds both names to the same canonical user create', async () => {
        const create = vi.fn().mockResolvedValue({ id: 'account-1' });
        const client = accountPrismaClient({
            earlyBirdUser: { create },
        } as unknown as PrismaClient);

        await withAccountEmailSignupProfile({
            displayName: '李', realName: '李',
        }, () => client.earlyBirdUser.create({
            data: {
                id: 'account-1', name: '李', email: 'li@example.test',
                emailVerified: false,
            },
        }));

        expect(create).toHaveBeenCalledWith({
            data: {
                id: 'account-1', name: '李', email: 'li@example.test',
                emailVerified: false,
                beaconProfile: { create: { displayName: '李', realName: '李' } },
            },
        });
    });

    it('does not attach private data to provider-created users outside signup', async () => {
        const create = vi.fn().mockResolvedValue({ id: 'google-account' });
        const client = accountPrismaClient({
            earlyBirdUser: { create },
        } as unknown as PrismaClient);
        await client.earlyBirdUser.create({
            data: {
                id: 'google-account', name: 'Provider Name', email: 'google@example.test',
                emailVerified: true,
            },
        });
        expect(create).toHaveBeenCalledWith(expect.not.objectContaining({
            data: expect.objectContaining({ beaconProfile: expect.anything() }),
        }));
    });

    it('wraps callback transaction clients while preserving array transactions', async () => {
        const create = vi.fn().mockResolvedValue({ id: 'account-transaction' });
        const transaction = vi.fn(async (input: unknown) => {
            if (typeof input !== 'function') return input;
            return (input as (client: unknown) => Promise<unknown>)({ earlyBirdUser: { create } });
        });
        const client = accountPrismaClient({ $transaction: transaction } as unknown as PrismaClient);
        await withAccountEmailSignupProfile({ displayName: 'Preferred', realName: 'Private' }, () =>
            client.$transaction((transactionClient) => transactionClient.earlyBirdUser.create({
                data: {
                    id: 'account-transaction', name: 'Preferred',
                    email: 'transaction@example.test', emailVerified: false,
                },
            })));
        expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
            beaconProfile: { create: { displayName: 'Preferred', realName: 'Private' } },
        }) });

        const operations = [Promise.resolve('one'), Promise.resolve('two')];
        await (client.$transaction as unknown as (input: unknown) => Promise<unknown>)(operations);
        expect(transaction).toHaveBeenLastCalledWith(operations);
    });
});
