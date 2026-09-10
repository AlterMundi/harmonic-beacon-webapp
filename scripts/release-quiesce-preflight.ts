#!/usr/bin/env tsx

import { TrackType } from '@livekit/protocol';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { Pool } from 'pg';

import { getRoomService } from '../src/lib/livekit-server';
import { assertReleaseContinuity } from '../src/lib/release-continuity-state';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const liveSessions = await prisma.scheduledSession.findMany({
      select: { id: true },
      where: { status: 'LIVE' },
    });
    const roomService = getRoomService(5_000);
    const liveKitRooms = await roomService.listRooms();
    const rooms = await Promise.all(liveKitRooms.map(async (room) => ({
      name: room.name,
      participants: room.numParticipants > 0
        ? (await roomService.listParticipants(room.name)).map((participant) => ({
            identity: participant.identity,
            hasPublishedAudio: participant.tracks.some((track) => track.type === TrackType.AUDIO && !track.muted),
          }))
        : [],
    })));
    assertReleaseContinuity({
      liveSessionIds: liveSessions.map((session) => session.id),
      rooms,
    });
    console.log(JSON.stringify({ safe: true, liveSessions: 0, activeParticipants: 0 }));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void main().catch(() => {
  console.error('Release DB/room/audio continuity preflight failed');
  process.exitCode = 1;
});
