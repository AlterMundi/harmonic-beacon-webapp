import { createHmac } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

const WINDOW_MS = 15 * 60 * 1_000;

function digestKey(kind: string, value: string, secret: string): string {
    return `${kind}:${createHmac('sha256', secret).update(value, 'utf8').digest('hex')}`;
}

function trustedProxyHops(): number {
    const raw = process.env.BEACON_ACCOUNT_TRUSTED_PROXY_HOPS?.trim() ?? '1';
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 4) return 1;
    return parsed;
}

function sourceAddress(request: Request): string {
    const direct = request.headers.get('x-real-ip')?.trim();
    const chain = request.headers.get('x-forwarded-for')?.split(',')
        .map((item) => item.trim()).filter(Boolean) ?? [];
    const hops = trustedProxyHops();
    const forwarded = chain.at(-(hops + 1));
    const result = direct || forwarded;
    return result && result.length <= 128 ? result : 'unavailable';
}

async function consumeBucket(
    transaction: Prisma.TransactionClient,
    input: { key: string; kind: string; max: number; now: Date },
): Promise<boolean> {
    const row = await transaction.beaconAccountAuthThrottle.upsert({
        where: { key: input.key },
        create: { key: input.key, kind: input.kind, windowStartedAt: input.now },
        update: {},
    });
    const windowEnd = new Date(row.windowStartedAt.getTime() + WINDOW_MS);
    if (row.blockedUntil && row.blockedUntil > input.now) return false;
    if (windowEnd <= input.now) {
        await transaction.beaconAccountAuthThrottle.update({
            where: { key: input.key },
            data: { windowStartedAt: input.now, attempts: 1, blockedUntil: null },
        });
        return true;
    }
    if (row.attempts >= input.max) {
        await transaction.beaconAccountAuthThrottle.update({
            where: { key: input.key }, data: { blockedUntil: windowEnd },
        });
        return false;
    }
    await transaction.beaconAccountAuthThrottle.update({
        where: { key: input.key }, data: { attempts: { increment: 1 } },
    });
    return true;
}

export async function consumeAccountRateLimit(input: {
    request: Request;
    email: string;
    purpose: string;
    secret: string;
    maxPerEmail?: number;
    maxPerOrigin?: number;
    maxGlobal?: number;
    includeEmailBucket?: boolean;
    includeOriginBucket?: boolean;
    now?: Date;
}): Promise<boolean> {
    const now = input.now ?? new Date();
    const originAddress = `${input.request.headers.get('origin') ?? 'no-origin'}\n${sourceAddress(input.request)}`;
    // Admit from lowest to highest cardinality and stop immediately. Once a
    // global/origin bucket is blocked, rotating attacker-controlled emails
    // cannot create an unbounded number of durable rows.
    const keys = [
        { kind: `${input.purpose}_global`, value: 'global', max: input.maxGlobal ?? 500 },
        ...(input.includeOriginBucket === false ? [] : [
            { kind: `${input.purpose}_origin`, value: originAddress, max: input.maxPerOrigin ?? 10 },
        ]),
        ...(input.includeEmailBucket === false ? [] : [
            { kind: `${input.purpose}_email`, value: input.email.trim().toLowerCase(), max: input.maxPerEmail ?? 3 },
        ]),
    ];
    try {
        return await prisma.$transaction(async (transaction) => {
            for (const key of keys) {
                const allowed = await consumeBucket(transaction, {
                    key: digestKey(key.kind, key.value, input.secret),
                    kind: key.kind,
                    max: key.max,
                    now,
                });
                if (!allowed) return false;
            }
            return true;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch {
        return false;
    }
}
