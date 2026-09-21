import { AsyncLocalStorage } from 'node:async_hooks';

import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/db';

export type AccountEmailSignupProfile = {
    displayName: string;
    realName: string;
};

const emailSignupProfile = new AsyncLocalStorage<AccountEmailSignupProfile>();

/** Keep private signup input request-scoped and out of Better Auth's user schema. */
export function withAccountEmailSignupProfile<T>(
    profile: AccountEmailSignupProfile,
    operation: () => Promise<T>,
): Promise<T> {
    return emailSignupProfile.run(profile, operation);
}

type AccountPrismaClient = PrismaClient | Prisma.TransactionClient;

/**
 * Better Auth's installed Prisma adapter generates the canonical user ID before
 * calling this delegate. Add the private profile at that final seam so Prisma
 * commits both rows together, without making realName an auth/user field.
 */
export function accountPrismaClient(client: AccountPrismaClient = prisma): PrismaClient {
    return new Proxy(client, {
        get(target, property, receiver) {
            if (property === '$transaction') {
                const transaction = Reflect.get(target, property, receiver) as (
                    input: unknown, ...options: unknown[]
                ) => Promise<unknown>;
                return (input: unknown, ...options: unknown[]) => {
                    if (typeof input !== 'function') return transaction.call(target, input, ...options);
                    const callback = input as (transaction: Prisma.TransactionClient) => Promise<unknown>;
                    return transaction.call(target, (transactionClient: Prisma.TransactionClient) =>
                        callback(accountPrismaClient(transactionClient)), ...options);
                };
            }
            if (property === 'earlyBirdUser') {
                const delegate = Reflect.get(target, property, receiver) as PrismaClient['earlyBirdUser'];
                return new Proxy(delegate, {
                    get(delegateTarget, delegateProperty, delegateReceiver) {
                        if (delegateProperty !== 'create') {
                            return Reflect.get(delegateTarget, delegateProperty, delegateReceiver);
                        }
                        return async (args: Prisma.EarlyBirdUserCreateArgs) => {
                            const profile = emailSignupProfile.getStore();
                            if (!profile) return delegate.create(args);
                            return delegate.create({
                                ...args,
                                data: {
                                    ...args.data,
                                    beaconProfile: {
                                        create: {
                                            displayName: profile.displayName,
                                            realName: profile.realName,
                                        },
                                    },
                                },
                            });
                        };
                    },
                });
            }
            return Reflect.get(target, property, receiver);
        },
    }) as PrismaClient;
}
