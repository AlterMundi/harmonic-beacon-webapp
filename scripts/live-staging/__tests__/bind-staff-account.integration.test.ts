import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    AUDIT_ACTION,
    BindingConflictError,
    STAGING_ACCOUNT_ISSUER,
    provisionStaffAccountBinding,
} from '../bind-staff-account';

const enabled = process.env.STAFF_BINDING_INTEGRATION_TEST === '1';
const databaseUrl = process.env.DATABASE_URL ?? '';
const suite = enabled ? describe : describe.skip;
let pool: Pool;
let prisma: PrismaClient;
const userIds: string[] = [];

function input(staffUserId: string, accountSubject: string) {
    return { accountIssuer: STAGING_ACCOUNT_ISSUER, accountSubject, staffUserId };
}

async function createStaff(disabled = false): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({
        data: {
            id,
            email: `staff-binding-${id}@invalid.example`,
            name: 'Synthetic staff binding test',
            role: 'ADMIN',
            passwordDigest: 'synthetic-not-a-login-secret',
            disabledAt: disabled ? new Date() : null,
        },
    });
    return id;
}

suite('Live staging staff Account binding PostgreSQL contract', () => {
    beforeAll(async () => {
        const parsed = new URL(databaseUrl);
        if (!parsed.pathname.endsWith('_test') && parsed.pathname !== '/beacon_test') {
            throw new Error('staff binding integration test refuses a non-test database');
        }
        pool = new Pool({ connectionString: databaseUrl, max: 8 });
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    });

    afterAll(async () => {
        if (!prisma) return;
        await prisma.auditLog.deleteMany({
            where: { action: AUDIT_ACTION, reason: 'live_staging_operator_provision' },
        });
        await prisma.staffAccountBinding.deleteMany({ where: { staffUserId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
        await pool.end();
    });

    it('dry-runs read-only, creates atomically and replays without duplicate audit', async () => {
        const staffUserId = await createStaff();
        const bindingInput = input(staffUserId, `opaque-${randomUUID()}`);
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
        expect(await prisma.auditLog.count({
            where: { action: AUDIT_ACTION, targetId: created.bindingId ?? undefined },
        })).toBe(1);
        expect(await prisma.auditLog.findFirstOrThrow({
            where: { action: AUDIT_ACTION, targetId: created.bindingId ?? undefined },
            select: { actorUserId: true, reason: true, metadata: true },
        })).toEqual({
            actorUserId: null,
            reason: 'live_staging_operator_provision',
            metadata: { accountIssuer: STAGING_ACCOUNT_ISSUER, source: 'root_one_shot_utility' },
        });
        expect({
            sessions: await prisma.webSession.count(),
            tickets: await prisma.ticketEntitlement.count(),
            events: await prisma.scheduledSession.count(),
        }).toEqual(before);
    });

    it('keeps the mapping one-to-one under concurrency', async () => {
        const firstStaff = await createStaff();
        const secondStaff = await createStaff();
        const subject = `opaque-race-${randomUUID()}`;
        const outcomes = await Promise.allSettled([
            provisionStaffAccountBinding(prisma, input(firstStaff, subject), true),
            provisionStaffAccountBinding(prisma, input(secondStaff, subject), true),
        ]);
        expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect(await prisma.staffAccountBinding.count({
            where: { accountIssuer: STAGING_ACCOUNT_ISSUER, accountSubject: subject },
        })).toBe(1);
    });

    it('fails closed for conflicting, disabled or missing local authority', async () => {
        const staff = await createStaff();
        const otherStaff = await createStaff();
        const subject = `opaque-conflict-${randomUUID()}`;
        await provisionStaffAccountBinding(prisma, input(staff, subject), true);
        await expect(provisionStaffAccountBinding(prisma, input(otherStaff, subject), true))
            .rejects.toBeInstanceOf(BindingConflictError);
        await expect(provisionStaffAccountBinding(prisma, input(staff, `opaque-other-${randomUUID()}`), true))
            .rejects.toBeInstanceOf(BindingConflictError);

        const disabledStaff = await createStaff(true);
        await expect(provisionStaffAccountBinding(prisma, input(disabledStaff, `opaque-disabled-${randomUUID()}`), true))
            .rejects.toBeInstanceOf(BindingConflictError);
        await expect(provisionStaffAccountBinding(prisma, input(randomUUID(), `opaque-missing-${randomUUID()}`), true))
            .rejects.toBeInstanceOf(BindingConflictError);

        await prisma.staffAccountBinding.update({
            where: { staffUserId: staff },
            data: { disabledAt: new Date() },
        });
        await expect(provisionStaffAccountBinding(prisma, input(staff, subject), true))
            .rejects.toBeInstanceOf(BindingConflictError);
    });
});
