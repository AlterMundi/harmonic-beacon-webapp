#!/usr/bin/env tsx

import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { RoomServiceClient } from 'livekit-server-sdk';
import { Pool } from 'pg';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

import {
    assertStabilizationWindow,
    desiredSessionState,
    EVENT_CONTRACTS,
    EVENT_STABILIZATION_DEADLINE,
    stabilizationSnapshotDigest,
    type StabilizationSessionSnapshot,
    type StabilizationSnapshot,
    validateStabilizationSnapshot,
} from '../src/lib/event-stabilization';
import { redactError } from '../src/lib/redact';

type DbClient = Prisma.TransactionClient | PrismaClient;

type Options = {
    apply: boolean;
    backupConfirmed: boolean;
    confirm?: string;
};

function usage(exitCode: number): never {
    console.error(`Usage:
  npm run event:stabilize
  npm run event:stabilize -- --apply --backup-confirmed --confirm <dry-run-sha256>

Dry-run is the default and never mutates data. Apply refuses if the database
snapshot changed, a known room has participants, or the safety deadline passed.`);
    process.exit(exitCode);
}

function parseOptions(argv: string[]): Options {
    const options: Options = { apply: false, backupConfirmed: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--apply') options.apply = true;
        else if (argument === '--backup-confirmed') options.backupConfirmed = true;
        else if (argument === '--confirm') options.confirm = argv[++index];
        else if (argument === '--help' || argument === '-h') usage(0);
        else throw new Error(`Unknown argument: ${argument}`);
    }
    if (!options.apply && (options.backupConfirmed || options.confirm)) {
        throw new Error('--confirm and --backup-confirmed are valid only with --apply');
    }
    if (options.apply && (!options.backupConfirmed || !options.confirm)) {
        throw new Error('Apply requires both --backup-confirmed and --confirm <dry-run-sha256>');
    }
    if (options.confirm && !/^[a-f0-9]{64}$/.test(options.confirm)) {
        throw new Error('--confirm must be a lowercase SHA-256 digest');
    }
    return options;
}

async function readSnapshot(db: DbClient): Promise<StabilizationSnapshot> {
    const ids = EVENT_CONTRACTS.map((contract) => contract.id);
    const sessions = await db.scheduledSession.findMany({
        where: { id: { in: ids } },
        select: {
            id: true,
            title: true,
            roomName: true,
            language: true,
            scheduledAt: true,
            startedAt: true,
            endedAt: true,
            status: true,
            isTest: true,
            paidMode: true,
            attendeeCap: true,
            maxPublishers: true,
            facilitatorId: true,
        },
    });

    const result: StabilizationSessionSnapshot[] = [];
    for (const session of sessions) {
        const ticketRows = await db.ticketEntitlement.groupBy({
            by: ['state'],
            where: { scheduledSessionId: session.id },
            _count: { _all: true },
        });
        const ticketCounts = { ISSUED: 0, BOUND: 0, REVOKED: 0, EXPIRED: 0 };
        for (const row of ticketRows) ticketCounts[row.state] = row._count._all;

        const [unrevokedWebSessions, participants, raisedHands, activeGrants, reconcileNeeded] =
            await Promise.all([
                db.webSession.count({
                    where: {
                        revokedAt: null,
                        ticketEntitlement: { scheduledSessionId: session.id },
                    },
                }),
                db.sessionParticipant.count({ where: { scheduledSessionId: session.id } }),
                db.sessionParticipant.count({
                    where: { scheduledSessionId: session.id, raisedAt: { not: null } },
                }),
                db.sessionParticipant.count({
                    where: {
                        scheduledSessionId: session.id,
                        publishGrantedAt: { not: null },
                        publishRevokedAt: null,
                    },
                }),
                db.sessionParticipant.count({
                    where: { scheduledSessionId: session.id, grantReconcileNeeded: true },
                }),
            ]);

        result.push({
            ...session,
            scheduledAt: session.scheduledAt.toISOString(),
            startedAt: session.startedAt?.toISOString() ?? null,
            endedAt: session.endedAt?.toISOString() ?? null,
            counts: {
                tickets: ticketCounts,
                unrevokedWebSessions,
                participants,
                raisedHands,
                activeGrants,
                reconcileNeeded,
            },
        });
    }
    return { sessions: result };
}

async function assertRoomsEmpty(): Promise<Record<string, number>> {
    const apiKey = process.env.LIVEKIT_API_KEY?.trim();
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
    const configuredUrl = process.env.LIVEKIT_INTERNAL_URL?.trim()
        || process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim();
    if (!apiKey || !apiSecret || !configuredUrl) {
        throw new Error(
            'LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_INTERNAL_URL or NEXT_PUBLIC_LIVEKIT_URL are required',
        );
    }
    const httpUrl = configuredUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
    const counts: Record<string, number> = {};
    for (const contract of EVENT_CONTRACTS) {
        const participants = await roomService.listParticipants(contract.roomName);
        counts[contract.roomName] = participants.length;
    }
    const occupied = Object.entries(counts).filter(([, count]) => count > 0);
    if (occupied.length > 0) {
        throw new Error(
            `Refusing stabilization while LiveKit rooms are occupied: ${occupied
                .map(([room, count]) => `${room}=${count}`)
                .join(', ')}`,
        );
    }
    return counts;
}

function printDryRun(snapshot: StabilizationSnapshot, digest: string): void {
    const output = {
        mode: 'dry-run',
        digest,
        deadline: EVENT_STABILIZATION_DEADLINE.toISOString(),
        changes: EVENT_CONTRACTS.map((contract) => ({
            event: contract.key,
            id: contract.id,
            desiredStatus: contract.isTest ? 'CANCELLED' : 'SCHEDULED',
            desiredScheduledAt: contract.scheduledAt,
            current: snapshot.sessions.find((session) => session.id === contract.id),
        })),
        applyCommand: `npm run event:stabilize -- --apply --backup-confirmed --confirm ${digest}`,
    };
    console.log(JSON.stringify(output, null, 2));
}

function sessionNeedsUpdate(
    session: StabilizationSessionSnapshot,
    contract: (typeof EVENT_CONTRACTS)[number],
): boolean {
    if (session.scheduledAt !== contract.scheduledAt) return true;
    if (contract.isTest) return session.status !== 'CANCELLED' || session.endedAt === null;
    return session.status !== 'SCHEDULED' || session.startedAt !== null || session.endedAt !== null;
}

async function applyStabilization(
    prisma: PrismaClient,
    expectedDigest: string,
    now: Date,
): Promise<Record<string, unknown>> {
    assertStabilizationWindow(now);
    await assertRoomsEmpty();

    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`
                SELECT "id"
                FROM "scheduled_sessions"
                WHERE "id"::text IN (${Prisma.join(EVENT_CONTRACTS.map((contract) => contract.id))})
                ORDER BY "id"
                FOR UPDATE
            `,
        );

        const before = await readSnapshot(tx);
        validateStabilizationSnapshot(before);
        const actualDigest = stabilizationSnapshotDigest(before);
        if (actualDigest !== expectedDigest) {
            throw new Error(
                `Database changed after dry-run; expected ${expectedDigest}, found ${actualDigest}. Run dry-run again.`,
            );
        }

        // Recheck after acquiring the database locks. We never disconnect a room.
        const livekitRooms = await assertRoomsEmpty();
        const summary = {
            sessionsUpdated: 0,
            ticketsRevoked: 0,
            webSessionsRevoked: 0,
            grantsRevoked: 0,
            participantFlagsCleared: 0,
            realReconciliationFlagsCleared: 0,
            livekitRooms,
        };

        for (const contract of EVENT_CONTRACTS) {
            const session = before.sessions.find((candidate) => candidate.id === contract.id)!;
            if (sessionNeedsUpdate(session, contract)) {
                await tx.scheduledSession.update({
                    where: { id: contract.id },
                    data: desiredSessionState(contract, now),
                });
                summary.sessionsUpdated += 1;
            }

            if (contract.isTest) {
                const tickets = await tx.ticketEntitlement.updateMany({
                    where: {
                        scheduledSessionId: contract.id,
                        state: { in: ['ISSUED', 'BOUND'] },
                    },
                    data: {
                        state: 'REVOKED',
                        revokedAt: now,
                        revocationReason: 'Test event fixture retired before production event',
                    },
                });
                summary.ticketsRevoked += tickets.count;

                const webSessions = await tx.webSession.updateMany({
                    where: {
                        revokedAt: null,
                        ticketEntitlement: { scheduledSessionId: contract.id },
                    },
                    data: {
                        revokedAt: now,
                        revocationReason: 'Test event fixture retired before production event',
                    },
                });
                summary.webSessionsRevoked += webSessions.count;

                const grants = await tx.sessionParticipant.updateMany({
                    where: {
                        scheduledSessionId: contract.id,
                        publishGrantedAt: { not: null },
                        publishRevokedAt: null,
                    },
                    data: {
                        publishRevokedAt: now,
                        grantVersion: { increment: 1 },
                        grantReconcileNeeded: false,
                        grantReason: 'Test event fixture retired before production event',
                    },
                });
                summary.grantsRevoked += grants.count;

                const flags = await tx.sessionParticipant.updateMany({
                    where: {
                        scheduledSessionId: contract.id,
                        OR: [
                            { raisedAt: { not: null } },
                            { grantReconcileNeeded: true },
                        ],
                    },
                    data: { raisedAt: null, grantReconcileNeeded: false },
                });
                summary.participantFlagsCleared += flags.count;
            } else {
                // Every stage room was checked empty twice. A reconciliation
                // flag on a disconnected real-event participant cannot
                // represent a live LiveKit disagreement and would otherwise
                // create a false incident in the event cockpit.
                const flags = await tx.sessionParticipant.updateMany({
                    where: {
                        scheduledSessionId: contract.id,
                        grantReconcileNeeded: true,
                    },
                    data: { grantReconcileNeeded: false },
                });
                summary.realReconciliationFlagsCleared += flags.count;
            }
        }

        const changed = Object.entries(summary)
            .filter(([key]) => key !== 'livekitRooms')
            .some(([, value]) => typeof value === 'number' && value > 0);
        if (changed) {
            await tx.auditLog.create({
                data: {
                    action: 'event.preflight_stabilization',
                    targetType: 'EVENT_WEEKEND',
                    targetId: '2026-08-08',
                    reason: 'Correct production schedule and retire test fixtures before event',
                    metadata: { beforeDigest: actualDigest, ...summary },
                },
            });
        }
        return { mode: 'apply', changed, beforeDigest: actualDigest, ...summary };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error('DATABASE_URL is required');

    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
        const snapshot = await readSnapshot(prisma);
        validateStabilizationSnapshot(snapshot);
        const digest = stabilizationSnapshotDigest(snapshot);
        if (!options.apply) {
            printDryRun(snapshot, digest);
            return;
        }
        const result = await applyStabilization(prisma, options.confirm!, new Date());
        console.log(JSON.stringify(result, null, 2));
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main().catch((error: unknown) => {
    console.error(redactError(error));
    process.exitCode = 1;
});
