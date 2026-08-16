#!/usr/bin/env -S npx tsx

import { listenerWithdrawalReceiptDigest } from '../src/lib/listener/consumer-withdrawal';
import { prisma } from '../src/lib/db';

const OPERATOR_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT_PATTERN = /^HBW-[0-9A-F]{30}$/;
const RESOLUTION_CODES = new Set([
    'CANCELLED',
    'REFUNDED',
    'CANCELLED_AND_REFUNDED',
    'DUPLICATE',
    'NOT_APPLICABLE',
]);

function usage(): never {
    throw new Error([
        'Usage:',
        '  listener-withdrawal-operator.ts list [limit]',
        '  listener-withdrawal-operator.ts show <request-uuid|receipt-code>',
        '  listener-withdrawal-operator.ts acknowledge <request-uuid> <operator-code>',
        '  listener-withdrawal-operator.ts resolve <request-uuid> <operator-code> <resolution-code>',
        '  listener-withdrawal-operator.ts metrics',
        '  listener-withdrawal-operator.ts prune-throttles [retention-hours]',
    ].join('\n'));
}

function assertRoot(): void {
    if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
        throw new Error('Refusing to expose or mutate the private queue outside a root-owned operator session.');
    }
}

function requestSelector(value: string) {
    if (UUID_PATTERN.test(value)) return { id: value };
    if (RECEIPT_PATTERN.test(value)) return { receiptDigest: listenerWithdrawalReceiptDigest(value) };
    return usage();
}

function operatorCode(value: string): string {
    if (!OPERATOR_PATTERN.test(value)) usage();
    return value;
}

async function main() {
    assertRoot();
    const [command, ...args] = process.argv.slice(2);

    if (command === 'metrics') {
        if (args.length !== 0) usage();
        const [received, acknowledged, oldest] = await Promise.all([
            prisma.listenerWithdrawalRequest.count({ where: { status: 'RECEIVED' } }),
            prisma.listenerWithdrawalRequest.count({ where: { status: 'ACKNOWLEDGED' } }),
            prisma.listenerWithdrawalRequest.findFirst({
                where: { status: { not: 'RESOLVED' } },
                orderBy: { createdAt: 'asc' },
                select: { createdAt: true },
            }),
        ]);
        const ageSeconds = oldest
            ? Math.max(0, Math.floor((Date.now() - oldest.createdAt.getTime()) / 1_000))
            : 0;
        process.stdout.write([
            '# HELP beacon_listener_withdrawal_open_requests Open consumer requests by bounded status.',
            '# TYPE beacon_listener_withdrawal_open_requests gauge',
            `beacon_listener_withdrawal_open_requests{status="received"} ${received}`,
            `beacon_listener_withdrawal_open_requests{status="acknowledged"} ${acknowledged}`,
            '# HELP beacon_listener_withdrawal_oldest_open_age_seconds Age of the oldest open request.',
            '# TYPE beacon_listener_withdrawal_oldest_open_age_seconds gauge',
            `beacon_listener_withdrawal_oldest_open_age_seconds ${ageSeconds}`,
            '',
        ].join('\n'));
        return;
    }

    if (command === 'prune-throttles') {
        if (args.length > 1) usage();
        const hours = args[0] === undefined ? 48 : Number(args[0]);
        if (!Number.isSafeInteger(hours) || hours < 2 || hours > 8_760) usage();
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1_000);
        const deleted = await prisma.listenerWithdrawalThrottle.deleteMany({
            where: { updatedAt: { lt: cutoff } },
        });
        process.stdout.write(`${JSON.stringify({ prunedThrottleRows: deleted.count, cutoff: cutoff.toISOString() })}\n`);
        return;
    }

    if (command === 'list') {
        if (args.length > 1) usage();
        const limit = args[0] === undefined ? 50 : Number(args[0]);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) usage();
        const rows = await prisma.listenerWithdrawalRequest.findMany({
            where: { status: { not: 'RESOLVED' } },
            orderBy: { createdAt: 'asc' },
            take: limit,
            select: {
                id: true,
                receiptLastFour: true,
                provider: true,
                requestKind: true,
                status: true,
                createdAt: true,
                acknowledgedAt: true,
            },
        });
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        return;
    }

    if (command === 'show') {
        if (args.length !== 1) usage();
        const row = await prisma.listenerWithdrawalRequest.findUnique({
            where: requestSelector(args[0]),
            select: {
                id: true,
                receiptLastFour: true,
                contactEmail: true,
                provider: true,
                requestKind: true,
                purchaseDate: true,
                locale: true,
                status: true,
                createdAt: true,
                acknowledgedAt: true,
                acknowledgedBy: true,
                resolvedAt: true,
                resolvedBy: true,
                resolutionCode: true,
            },
        });
        if (!row) throw new Error('Request not found.');
        process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
        return;
    }

    if (command === 'acknowledge') {
        if (args.length !== 2 || !UUID_PATTERN.test(args[0])) usage();
        const actor = operatorCode(args[1]);
        const now = new Date();
        const updated = await prisma.listenerWithdrawalRequest.updateMany({
            where: { id: args[0], status: 'RECEIVED' },
            data: { status: 'ACKNOWLEDGED', acknowledgedAt: now, acknowledgedBy: actor },
        });
        if (updated.count !== 1) {
            const current = await prisma.listenerWithdrawalRequest.findUnique({
                where: { id: args[0] }, select: { status: true },
            });
            if (!current) throw new Error('Request not found.');
            if (current.status !== 'ACKNOWLEDGED') throw new Error(`Cannot acknowledge request in ${current.status}.`);
        }
        process.stdout.write(`${JSON.stringify({ id: args[0], status: 'ACKNOWLEDGED' })}\n`);
        return;
    }

    if (command === 'resolve') {
        if (args.length !== 3 || !UUID_PATTERN.test(args[0])) usage();
        const actor = operatorCode(args[1]);
        const resolution = args[2].toUpperCase();
        if (!RESOLUTION_CODES.has(resolution)) usage();
        const updated = await prisma.listenerWithdrawalRequest.updateMany({
            where: { id: args[0], status: 'ACKNOWLEDGED' },
            data: {
                status: 'RESOLVED',
                resolvedAt: new Date(),
                resolvedBy: actor,
                resolutionCode: resolution,
            },
        });
        if (updated.count !== 1) {
            const current = await prisma.listenerWithdrawalRequest.findUnique({
                where: { id: args[0] },
                select: { status: true, resolutionCode: true },
            });
            if (!current || current.status !== 'RESOLVED' || current.resolutionCode !== resolution) {
                throw new Error('Request must exist and be ACKNOWLEDGED before resolution.');
            }
        }
        process.stdout.write(`${JSON.stringify({ id: args[0], status: 'RESOLVED', resolution })}\n`);
        return;
    }

    usage();
}

main()
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : 'Operator command failed.'}\n`);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
