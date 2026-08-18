// dotenv loaded from env in dev; production sets vars directly
let configDotenv: ((opts: { path: string }) => void) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require('dotenv');
  configDotenv = dotenv.config;
} catch {
  // dotenv not available in production; env vars are already set
}
if (configDotenv) {
  configDotenv({ path: '.env.local' });
  configDotenv({ path: '.env' });
}

import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

import {
    WEEKEND_ATTENDEE_CAP,
    WEEKEND_MAX_PUBLISHERS,
    loadSeedContract,
} from './seed-contract';

async function main() {
    // Validate every secret and both event definitions before opening a database connection.
    const { staff, events } = loadSeedContract();
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
        throw new Error('Missing required seed environment variable: DATABASE_URL');
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    try {
        await prisma.$transaction(async (tx) => {
            for (const member of staff) {
                const { accountSubject, ...staffRecord } = member;
                const user = await tx.user.upsert({
                    where: { email: member.email },
                    update: staffRecord,
                    create: staffRecord,
                });
                if (accountSubject) {
                    const accountIssuer = process.env.BEACON_ACCOUNT_ISSUER_URL?.trim().replace(/\/$/, '');
                    if (!accountIssuer) throw new Error('BEACON_ACCOUNT_ISSUER_URL is required for staff Account bindings');
                    const previous = await tx.staffAccountBinding.findUnique({
                        where: { staffUserId: user.id },
                        select: { accountIssuer: true, accountSubject: true, disabledAt: true },
                    });
                    const binding = await tx.staffAccountBinding.upsert({
                        where: { staffUserId: user.id },
                        update: { accountIssuer, accountSubject, disabledAt: null },
                        create: { accountIssuer, accountSubject, staffUserId: user.id },
                    });
                    if (
                        !previous ||
                        previous.accountIssuer !== accountIssuer ||
                        previous.accountSubject !== accountSubject ||
                        previous.disabledAt !== null
                    ) {
                        await tx.auditLog.create({
                            data: {
                                actorUserId: null,
                                action: 'account.staff.binding.upsert',
                                targetType: 'STAFF_ACCOUNT_BINDING',
                                targetId: binding.id,
                                metadata: { accountIssuer },
                            },
                        });
                    }
                }
            }

            const facilitator = await tx.user.findUniqueOrThrow({
                where: { email: staff[0].email },
                select: { id: true },
            });

            for (const event of events) {
                await tx.scheduledSession.upsert({
                    where: { id: event.id },
                    update: {
                        title: event.title,
                        description: event.description,
                        roomName: event.roomName,
                        language: event.language,
                        scheduledAt: event.scheduledAt,
                        isTest: event.isTest,
                        paidMode: true,
                        attendeeCap: WEEKEND_ATTENDEE_CAP,
                        maxPublishers: WEEKEND_MAX_PUBLISHERS,
                        facilitatorId: facilitator.id,
                    },
                    create: {
                        ...event,
                        paidMode: true,
                        attendeeCap: WEEKEND_ATTENDEE_CAP,
                        maxPublishers: WEEKEND_MAX_PUBLISHERS,
                        facilitatorId: facilitator.id,
                    },
                });

                const existingFacilitator = await tx.sessionParticipant.findFirst({
                    where: {
                        scheduledSessionId: event.id,
                        staffUserId: facilitator.id,
                    },
                    select: { id: true },
                });

                if (existingFacilitator) {
                    await tx.sessionParticipant.update({
                        where: { id: existingFacilitator.id },
                        data: {
                            publishRevokedAt: null,
                            grantReconcileNeeded: false,
                        },
                    });
                } else {
                    await tx.sessionParticipant.create({
                        data: {
                            scheduledSessionId: event.id,
                            staffUserId: facilitator.id,
                            participantIdentity: randomUUID(),
                            publishGrantedAt: new Date(),
                            grantChangedByUserId: facilitator.id,
                            grantReason: 'Weekend facilitator baseline grant',
                        },
                    });
                }
            }
        });

        console.log(`Seeded ${staff.length} staff records and ${events.length} weekend sessions.`);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown seed failure';
    console.error(`Seed failed: ${message}`);
    process.exitCode = 1;
});
