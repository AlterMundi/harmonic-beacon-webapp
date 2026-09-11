#!/usr/bin/env tsx

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

import { applyAuthorizedScheduleOperation } from '../src/lib/authorized-schedule-operation';

async function readRequest(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 8192) throw new Error('schedule request is too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const request = await readRequest();
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const result = await prisma.$transaction(async (tx) => applyAuthorizedScheduleOperation({
      findActor: (id) => tx.user.findUnique({ select: { id: true, role: true, disabledAt: true }, where: { id } }),
      findSession: (id) => tx.scheduledSession.findUnique({
        select: { id: true, scheduledAt: true, isTest: true, publicAccess: true, status: true, roomName: true },
        where: { id },
      }),
      update: async ({ sessionId, expectedScheduledAt, scheduledAt }) => {
        const result = await tx.scheduledSession.updateMany({
          data: { scheduledAt },
          where: {
            id: sessionId,
            scheduledAt: expectedScheduledAt,
            isTest: true,
            publicAccess: false,
            status: 'SCHEDULED',
            roomName: { startsWith: 'ops-e-rehearsal-' },
          },
        });
        return result.count === 1;
      },
      audit: (input) => tx.auditLog.create({ data: input }),
    }, request));
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void main().catch(() => {
  console.error('Authorized schedule operation failed');
  process.exitCode = 1;
});
