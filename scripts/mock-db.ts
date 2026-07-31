import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.auditLog.deleteMany().catch(() => {});
  await prisma.webSession.deleteMany().catch(() => {});
  await prisma.sessionParticipant.deleteMany().catch(() => {});
  await prisma.ticketEntitlement.deleteMany().catch(() => {});
  await prisma.scheduledSession.deleteMany().catch(() => {});
  await prisma.user.deleteMany().catch(() => {});

  const facilitator = await prisma.user.create({
    data: {
      email: 'facilitator@altermundi.net',
      name: 'Facilitator',
      role: 'FACILITATOR',
      passwordDigest: '$2a$10$mockhashforfacilitator',
    },
  });

  const spanishSession = await prisma.scheduledSession.create({
    data: {
      title: 'Proyección Armónica — Sesión en Español',
      roomName: 'harmonic-es-2026-08-01',
      language: 'SPANISH',
      scheduledAt: new Date('2026-08-01T14:30:00.000Z'),
      status: 'SCHEDULED',
      paidMode: true,
      attendeeCap: 150,
      maxPublishers: 6,
      facilitatorId: facilitator.id,
    },
  });

  const englishSession = await prisma.scheduledSession.create({
    data: {
      title: 'Harmonic Projection — English Session',
      roomName: 'harmonic-en-2026-08-02',
      language: 'ENGLISH',
      scheduledAt: new Date('2026-08-02T20:00:00.000Z'),
      status: 'SCHEDULED',
      paidMode: true,
      attendeeCap: 150,
      maxPublishers: 6,
      facilitatorId: facilitator.id,
    },
  });

  console.log('Mock data seeded:');
  console.log('  Spanish:', spanishSession.id, spanishSession.title);
  console.log('  English:', englishSession.id, englishSession.title);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
