import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    AUDIT_ACTION,
    AUDIT_REASON,
    BindingConflictError,
    PRODUCTION_ACCOUNT_ISSUER,
    provisionStaffAccountBinding,
} from '../bind-staff-account';

const enabled = process.env.STAFF_BINDING_INTEGRATION_TEST === '1';
const databaseUrl = process.env.DATABASE_URL ?? '';
const suite = enabled ? describe : describe.skip;
let pool: Pool;
let prisma: PrismaClient;
const userIds: string[] = [];

function input(staffUserId: string, accountSubject: string) {
    return { accountIssuer: PRODUCTION_ACCOUNT_ISSUER, accountSubject, staffUserId };
}

async function createStaff(disabled = false): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({
        data: {
            id,
            email: `production-staff-binding-${id}@invalid.example`,
            name: 'Synthetic production staff binding test',
            role: 'ADMIN',
            passwordDigest: 'synthetic-not-a-login-secret',
            disabledAt: disabled ? new Date() : null,
        },
    });
    return id;
}

suite('Live production staff Account binding PostgreSQL contract', () => {
    beforeAll(async () => {
        const parsed = new URL(databaseUrl);
        if (!parsed.pathname.endsWith('_test') && parsed.pathname !== '/beacon_test') {
            throw new Error('production staff binding integration test refuses a non-test database');
        }
        pool = new Pool({ connectionString: databaseUrl, max: 8 });
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    });

    afterAll(async () => {
        if (!prisma) return;
        await prisma.auditLog.deleteMany({ where: { action: AUDIT_ACTION, reason: AUDIT_REASON } });
        await prisma.staffAccountBinding.deleteMany({ where: { staffUserId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
        await pool.end();
    });

    it('dry-runs, creates atomically and replays with one production audit', async () => {
        const staffUserId = await createStaff();
        const bindingInput = input(staffUserId, `opaque-production-${randomUUID()}`);
        const before = {
            sessions: await prisma.webSession.count(),
            tickets: await prisma.ticketEntitlement.count(),
            events: await prisma.scheduledSession.count(),
        };

        await expect(provisionStaffAccountBinding(prisma, bindingInput, false)).resolves.toMatchObject({
            outcome: 'would-create', bindingId: null,
        });
        expect(await prisma.staffAccountBinding.count({ where: { staffUserId } })).toBe(0);
        const created = await provisionStaffAccountBinding(prisma, bindingInput, true);
        expect(created.outcome).toBe('created');
        await expect(provisionStaffAccountBinding(prisma, bindingInput, true)).resolves.toMatchObject({
            outcome: 'already-bound', bindingId: created.bindingId,
        });
        expect(await prisma.auditLog.findMany({
            where: { action: AUDIT_ACTION, targetId: created.bindingId ?? undefined },
            select: { actorUserId: true, reason: true, metadata: true },
        })).toEqual([{
            actorUserId: null,
            reason: AUDIT_REASON,
            metadata: { accountIssuer: PRODUCTION_ACCOUNT_ISSUER, source: 'root_one_shot_utility' },
        }]);
        expect({
            sessions: await prisma.webSession.count(),
            tickets: await prisma.ticketEntitlement.count(),
            events: await prisma.scheduledSession.count(),
        }).toEqual(before);
    });

    it('keeps the mapping one-to-one and rejects disabled local authority', async () => {
        const firstStaff = await createStaff();
        const secondStaff = await createStaff();
        const subject = `opaque-production-race-${randomUUID()}`;
        const outcomes = await Promise.allSettled([
            provisionStaffAccountBinding(prisma, input(firstStaff, subject), true),
            provisionStaffAccountBinding(prisma, input(secondStaff, subject), true),
        ]);
        expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect(await prisma.staffAccountBinding.count({
            where: { accountIssuer: PRODUCTION_ACCOUNT_ISSUER, accountSubject: subject },
        })).toBe(1);

        const disabledStaff = await createStaff(true);
        await expect(provisionStaffAccountBinding(prisma,
            input(disabledStaff, `opaque-production-disabled-${randomUUID()}`), true))
            .rejects.toBeInstanceOf(BindingConflictError);
    });
});
