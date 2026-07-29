/**
 * Weekend ticket batch CLI (WS1-03).
 *
 * Usage:
 *   npx tsx scripts/weekend-tickets.ts generate --event <sessionId> --tier GLOBAL_NORTH --count 100 [--out tickets.csv]
 *   npx tsx scripts/weekend-tickets.ts import   --event <sessionId> --tier GLOBAL_SOUTH --file codes.csv
 *
 * Both commands enforce the event's 150-attendee cap across paid and comp
 * entitlements, store only HMAC digests + last-four (src/lib/ticket-code.ts),
 * and write an audit row. `generate` prints or writes the one-time plaintext
 * CSV export for the ticket platform; imports are idempotent (digest
 * duplicates are skipped, never duplicated).
 *
 * The export contains plaintext codes: keep it under ops control, never
 * commit it, and prefer the offline/paper mapping described in the WS1-03
 * risk notes for admission support.
 */

import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import { Pool } from 'pg';

import {
    batchExceedsCap,
    buildTicketCsv,
    generateTicketCodes,
    parseTicketCsv,
    ticketExpiresAt,
} from '../src/lib/admission';
import { ticketCodeStorage } from '../src/lib/ticket-code';

const PAID_TIERS = ['GLOBAL_NORTH', 'GLOBAL_SOUTH'] as const;
type PaidTier = (typeof PAID_TIERS)[number];

type CliOptions = {
    command: 'generate' | 'import';
    event: string;
    tier: PaidTier;
    count?: number;
    file?: string;
    out?: string;
};

function usage(): never {
    console.error(
        'Usage:\n' +
        '  weekend-tickets.ts generate --event <sessionId> --tier GLOBAL_NORTH|GLOBAL_SOUTH --count <n> [--out file.csv]\n' +
        '  weekend-tickets.ts import   --event <sessionId> --tier GLOBAL_NORTH|GLOBAL_SOUTH --file codes.csv',
    );
    process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
    const [command, ...rest] = argv;
    if (command !== 'generate' && command !== 'import') {
        usage();
    }

    const flags = new Map<string, string>();
    for (let index = 0; index < rest.length; index += 2) {
        const key = rest[index];
        const value = rest[index + 1];
        if (!key?.startsWith('--') || value === undefined) {
            usage();
        }
        flags.set(key.slice(2), value);
    }

    const event = flags.get('event')?.trim();
    const tier = flags.get('tier')?.trim().toUpperCase();
    if (!event || !PAID_TIERS.includes(tier as PaidTier)) {
        usage();
    }

    const options: CliOptions = { command, event: event!, tier: tier as PaidTier };

    if (command === 'generate') {
        const count = Number(flags.get('count'));
        if (!Number.isSafeInteger(count) || count < 1 || count > 150) {
            usage();
        }
        options.count = count;
        options.out = flags.get('out');
    } else {
        const file = flags.get('file');
        if (!file) {
            usage();
        }
        options.file = file;
    }

    return options;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
        throw new Error('Missing required environment variable: DATABASE_URL');
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    try {
        const codes = options.command === 'generate'
            ? generateTicketCodes(options.count!)
            : [...new Set(parseTicketCsv(readFileSync(options.file!, 'utf8')))];

        const result = await prisma.$transaction(async (tx) => {
            const session = await tx.scheduledSession.findUnique({ where: { id: options.event } });
            if (!session) {
                throw new Error(`No scheduled session with id ${options.event}`);
            }

            const active = await tx.ticketEntitlement.count({
                where: { scheduledSessionId: session.id, state: { not: 'REVOKED' } },
            });
            if (batchExceedsCap(session.attendeeCap, active, codes.length)) {
                throw new Error(
                    `Refused: ${codes.length} tickets would exceed the attendee cap ` +
                    `(${active}/${session.attendeeCap} seats held)`,
                );
            }

            const created = await tx.ticketEntitlement.createMany({
                data: codes.map((code) => ({
                    scheduledSessionId: session.id,
                    ...ticketCodeStorage(code),
                    tier: options.tier,
                    expiresAt: ticketExpiresAt(session.scheduledAt),
                })),
                skipDuplicates: true,
            });

            await tx.auditLog.create({
                data: {
                    actorUserId: null,
                    action: options.command === 'generate' ? 'ticket.batch_generate' : 'ticket.batch_import',
                    targetType: 'SCHEDULED_SESSION',
                    targetId: session.id,
                    metadata: {
                        source: 'cli',
                        tier: options.tier,
                        count: created.count,
                        skipped: codes.length - created.count,
                    } satisfies Prisma.InputJsonValue,
                },
            });

            return { title: session.title, created: created.count };
        });

        if (options.command === 'generate') {
            // The one-time plaintext export: to the named file, or stdout.
            // Codes are never logged anywhere else.
            const csv = buildTicketCsv(codes.map((code) => ({
                code,
                tier: options.tier,
                eventTitle: result.title,
                urlPrefix: process.env.TICKET_LOGIN_URL_PREFIX?.trim() || 'https://live.harmonicbeacon.com/',
            })));
            if (options.out) {
                await writeFile(options.out, csv, { mode: 0o600 });
                console.error(`Wrote ${result.created} codes to ${options.out} (mode 0600). Keep this file under ops control; never commit it.`);
            } else {
                process.stdout.write(csv);
            }
        }

        console.error(`${options.command}: ${result.created} created, ${codes.length - result.created} skipped (already existed).`);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown ticket batch failure';
    console.error(`weekend-tickets failed: ${message}`);
    process.exitCode = 1;
});
