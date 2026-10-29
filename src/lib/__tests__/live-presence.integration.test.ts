import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { observeLivePresence } from '@/lib/live-presence';

const integration = process.env.LIVE_PRESENCE_INTEGRATION_TEST === '1' ? describe : describe.skip;
const sessionId = randomUUID();
const staffId = randomUUID();
let safeDatabase = false;

integration('Live presence PostgreSQL concurrency', () => {
    beforeAll(async () => {
        const configured = process.env.DATABASE_URL;
        if (!configured) throw Error('A disposable *_test database is required');
        const expected = new URL(configured).pathname.slice(1);
        const [actual] = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
        if (!expected.endsWith('_test') || actual.database !== expected) throw Error('Unsafe integration database');
        safeDatabase = true;
        await prisma.user.create({ data: { id: staffId, email: `${staffId}@integration.invalid`, name: 'Presence fixture', role: 'FACILITATOR', passwordDigest: 'unused' } });
        await prisma.scheduledSession.create({ data: { id: sessionId, title: 'Test presence concurrency', roomName: sessionId, language: 'SPANISH', scheduledAt: new Date(), status: 'LIVE', facilitatorId: staffId, isTest: true } });
        await prisma.sessionParticipant.create({ data: { scheduledSessionId: sessionId, staffUserId: staffId, participantIdentity: 'presence-fixture' } });
    });
    afterAll(async () => {
        if (!safeDatabase) return;
        await prisma.scheduledSession.deleteMany({ where: { id: sessionId } });
        await prisma.user.deleteMany({ where: { id: staffId } });
    });
    it('converges concurrent heartbeats to one interval without losing reconnect increments', async () => {
        const now = new Date();
        const results = await Promise.allSettled(Array.from({ length: 5 }, () => observeLivePresence({ scheduledSessionId: sessionId, participantIdentity: 'presence-fixture', now, reconnect: true })));
        const rejected = results.filter(result => result.status === 'rejected');
        // Count only; never print SQL, connection strings or participant data.
        expect(rejected.length, 'concurrent presence writes must converge').toBe(0);
        const rows = await prisma.livePresenceInterval.findMany({ where: { scheduledSessionId: sessionId } });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ generation: 1, endedAt: null, reconnectCount: 5 });
    });
    it('recovers a real row-lock snapshot conflict with a concurrent participant update', async () => {
        const writer = new pg.Client({ connectionString: process.env.DATABASE_URL });
        await writer.connect();
        try {
            await writer.query('BEGIN');
            await writer.query('UPDATE session_participants SET display_name=$2 WHERE scheduled_session_id=$1', [sessionId, 'Updated fixture']);
            const observation = observeLivePresence({ scheduledSessionId: sessionId, participantIdentity: 'presence-fixture' })
                .then(value => ({ ok: true, value }), () => ({ ok: false }));
            let blocked = false;
            for (let i = 0; i < 100; i += 1) {
                const [result] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (
                    SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
                    AND wait_event_type='Lock' AND query LIKE ${'%FROM "session_participants"%'}
                ) AS blocked`;
                if (result.blocked) { blocked = true; break; }
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            await writer.query('COMMIT');
            expect(blocked, 'the presence snapshot must precede the competing commit').toBe(true);
            expect(await observation).toMatchObject({ ok: true, value: { generation: 1 } });
            expect(await prisma.livePresenceInterval.count({ where: { scheduledSessionId: sessionId } })).toBe(1);
        } finally {
            await writer.query('ROLLBACK'); await writer.end();
        }
    });
});
