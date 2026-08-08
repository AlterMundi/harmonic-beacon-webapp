import type {
    EarlyBirdFreeSchedule,
    EarlyBirdMembershipProjection,
    EarlyBirdWelcomeAccess,
} from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

import { membershipAccessDecision } from './membership';

export const EARLY_BIRD_WELCOME_DURATION_MS = 30 * 60 * 1000;

export type EarlyBirdWelcomeAccessState = {
    available: boolean;
    active: boolean;
    used: boolean;
    startedAt: Date | null;
    endsAt: Date | null;
};

export class EarlyBirdWelcomeAccessInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EarlyBirdWelcomeAccessInputError';
    }
}

export class EarlyBirdWelcomeAccessUnavailableError extends Error {
    constructor() {
        super('The first-listen welcome access is not available');
        this.name = 'EarlyBirdWelcomeAccessUnavailableError';
    }
}

export function welcomeAccessState(
    access: EarlyBirdWelcomeAccess | null,
    now = new Date(),
    eligible = true,
): EarlyBirdWelcomeAccessState {
    const active = Boolean(access && access.startedAt <= now && now < access.endsAt);
    return {
        available: eligible && access === null,
        active,
        used: access !== null,
        startedAt: access?.startedAt ?? null,
        endsAt: access?.endsAt ?? null,
    };
}

function eligibleForWelcome(
    projection: EarlyBirdMembershipProjection | null,
    schedule: EarlyBirdFreeSchedule | null,
    now: Date,
): boolean {
    return !membershipAccessDecision(projection, now).allowed && schedule === null;
}

export async function startEarlyBirdWelcomeAccess(input: {
    accountId: string;
    activationRequestId: string;
    now?: Date;
}): Promise<{ access: EarlyBirdWelcomeAccess; state: EarlyBirdWelcomeAccessState; replayed: boolean }> {
    const now = input.now ?? new Date();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(input.activationRequestId)) {
        throw new EarlyBirdWelcomeAccessInputError('activationRequestId must be a UUID');
    }

    const outcome = await prisma.$transaction(async (tx) => {
        const accounts = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "early_bird_users" WHERE "id" = ${input.accountId} FOR UPDATE`,
        );
        if (accounts.length !== 1) {
            throw new EarlyBirdWelcomeAccessInputError('Listener account does not exist');
        }

        const [projection, schedule, existing] = await Promise.all([
            tx.earlyBirdMembershipProjection.findUnique({ where: { accountId: input.accountId } }),
            tx.earlyBirdFreeSchedule.findUnique({ where: { accountId: input.accountId } }),
            tx.earlyBirdWelcomeAccess.findUnique({ where: { accountId: input.accountId } }),
        ]);
        if (existing?.activationRequestId === input.activationRequestId) {
            return { access: existing, replayed: true };
        }
        if (existing || !eligibleForWelcome(projection, schedule, now)) {
            throw new EarlyBirdWelcomeAccessUnavailableError();
        }

        const access = await tx.earlyBirdWelcomeAccess.create({
            data: {
                accountId: input.accountId,
                startedAt: now,
                endsAt: new Date(now.getTime() + EARLY_BIRD_WELCOME_DURATION_MS),
                activationRequestId: input.activationRequestId,
            },
        });
        await tx.earlyBirdStreamLease.updateMany({
            where: { accountId: input.accountId, evictedAt: null },
            data: { evictedAt: now },
        });
        return { access, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
        ...outcome,
        state: welcomeAccessState(outcome.access, now),
    };
}

export function serializeWelcomeAccessState(state: EarlyBirdWelcomeAccessState) {
    return {
        ...state,
        startedAt: state.startedAt?.toISOString() ?? null,
        endsAt: state.endsAt?.toISOString() ?? null,
    };
}

export type SerializedEarlyBirdWelcomeAccessState = ReturnType<typeof serializeWelcomeAccessState>;
