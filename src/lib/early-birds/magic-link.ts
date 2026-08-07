import { createHash, createHmac } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

export const EARLY_BIRD_MAGIC_LINK_PATH = '/sign-in/magic-link';
export const EARLY_BIRD_MAGIC_LINK_VERIFY_PATH = '/magic-link/verify';
export const EARLY_BIRD_MAGIC_LINK_TTL_SECONDS = 10 * 60;
export const EARLY_BIRD_MAGIC_LINK_DELIVERY_PATH = '/api/internal/v1/listener-magic-links/deliver';

const EMAIL_WINDOW_MS = 15 * 60 * 1_000;
const EMAIL_WINDOW_MAX = 3;
const ORIGIN_IP_WINDOW_MS = 15 * 60 * 1_000;
const ORIGIN_IP_WINDOW_MAX = 10;
const GENERIC_RESPONSE_FLOOR_MS = 250;
const THROTTLE_RETENTION_MS = 24 * 60 * 60 * 1_000;

type MagicLinkEnvironment = Record<string, string | undefined> & {
    EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL?: string;
    EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN?: string;
    EARLY_BIRDS_MAGIC_LINK_RATE_SECRET?: string;
};

type DeliveryConfiguration = {
    url: string;
    token: string;
    rateSecret: string;
};

type ThrottleClient = Pick<typeof prisma, '$transaction'>;

function nonEmpty(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

export function earlyBirdMagicLinkConfiguration(
    environment: MagicLinkEnvironment = process.env,
): DeliveryConfiguration | null {
    const rawURL = nonEmpty(environment.EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL);
    const token = nonEmpty(environment.EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN);
    const rateSecret = nonEmpty(environment.EARLY_BIRDS_MAGIC_LINK_RATE_SECRET);
    if (!rawURL || !token || token.length < 32 || !rateSecret || rateSecret.length < 32) return null;

    try {
        const url = new URL(rawURL);
        if (!['http:', 'https:'].includes(url.protocol) ||
            url.username || url.password || url.search || url.hash ||
            url.pathname !== EARLY_BIRD_MAGIC_LINK_DELIVERY_PATH) return null;
        return { url: url.toString(), token, rateSecret };
    } catch {
        return null;
    }
}

export function earlyBirdMagicLinkAvailable(
    environment: MagicLinkEnvironment = process.env,
): boolean {
    return earlyBirdMagicLinkConfiguration(environment) !== null;
}

export function hashEarlyBirdMagicLinkToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

function bucketKey(kind: 'email' | 'origin_ip', value: string, secret: string): string {
    const digest = createHmac('sha256', secret).update(value, 'utf8').digest('hex');
    return `${kind}:${digest}`;
}

function sourceAddress(request: Request | undefined): string {
    // Listener nginx overwrites X-Real-IP with its direct peer. A caller may
    // prefix X-Forwarded-For before `$proxy_add_x_forwarded_for`, so trusting
    // its first value would let one client manufacture fresh throttle buckets.
    const direct = request?.headers.get('x-real-ip')?.trim();
    const forwarded = request?.headers.get('x-forwarded-for')
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .at(-1);
    const address = direct || forwarded;
    return address && address.length <= 128 ? address : 'unavailable';
}

async function consumeThrottleBucket(
    transaction: Prisma.TransactionClient,
    input: {
        key: string;
        kind: 'email' | 'origin_ip';
        now: Date;
        windowMs: number;
        max: number;
    },
): Promise<boolean> {
    const current = await transaction.earlyBirdMagicLinkThrottle.upsert({
        where: { key: input.key },
        create: {
            key: input.key,
            kind: input.kind,
            windowStartedAt: input.now,
            attempts: 0,
        },
        update: {},
    });
    const windowEnd = new Date(current.windowStartedAt.getTime() + input.windowMs);
    if (current.blockedUntil && current.blockedUntil > input.now) return false;
    if (windowEnd <= input.now) {
        await transaction.earlyBirdMagicLinkThrottle.update({
            where: { key: input.key },
            data: {
                windowStartedAt: input.now,
                attempts: 1,
                blockedUntil: null,
            },
        });
        return true;
    }
    if (current.attempts >= input.max) {
        await transaction.earlyBirdMagicLinkThrottle.update({
            where: { key: input.key },
            data: { blockedUntil: windowEnd },
        });
        return false;
    }
    await transaction.earlyBirdMagicLinkThrottle.update({
        where: { key: input.key },
        data: { attempts: { increment: 1 } },
    });
    return true;
}

export async function consumeEarlyBirdMagicLinkRateLimit(input: {
    email: string;
    request?: Request;
    secret: string;
    now?: Date;
    client?: ThrottleClient;
}): Promise<boolean> {
    const now = input.now ?? new Date();
    const origin = input.request?.headers.get('origin')?.trim() || 'no-origin';
    const keys = {
        email: bucketKey('email', input.email.trim().toLowerCase(), input.secret),
        originIp: bucketKey('origin_ip', `${origin}\n${sourceAddress(input.request)}`, input.secret),
    };
    try {
        return await (input.client ?? prisma).$transaction(async (transaction) => {
            await transaction.earlyBirdMagicLinkThrottle.deleteMany({
                where: { updatedAt: { lt: new Date(now.getTime() - THROTTLE_RETENTION_MS) } },
            });
            const emailAllowed = await consumeThrottleBucket(transaction, {
                key: keys.email,
                kind: 'email',
                now,
                windowMs: EMAIL_WINDOW_MS,
                max: EMAIL_WINDOW_MAX,
            });
            const originIpAllowed = await consumeThrottleBucket(transaction, {
                key: keys.originIp,
                kind: 'origin_ip',
                now,
                windowMs: ORIGIN_IP_WINDOW_MS,
                max: ORIGIN_IP_WINDOW_MAX,
            });
            return emailAllowed && originIpAllowed;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch {
        // Abuse-control uncertainty must never turn into an unbounded send.
        return false;
    }
}

export async function earlyBirdMagicLinkSessionAllowed(
    userId: string,
    contextPath: string | undefined,
    client: Pick<typeof prisma, 'earlyBirdIdentity'> = prisma,
): Promise<boolean> {
    if (!contextPath?.endsWith(EARLY_BIRD_MAGIC_LINK_VERIFY_PATH)) return true;
    return (await client.earlyBirdIdentity.count({ where: { userId } })) === 0;
}

function localeFromMetadata(metadata: Record<string, unknown> | undefined): 'es' | 'en' {
    return metadata?.locale === 'es' ? 'es' : 'en';
}

async function waitForGenericResponseFloor(startedAt: number): Promise<void> {
    const remaining = GENERIC_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

/**
 * Deliver through a narrow internal boundary owned by the existing mail service.
 * This callback deliberately resolves for every outcome so the public endpoint
 * cannot enumerate accounts or mail-provider state.
 */
export async function deliverEarlyBirdMagicLink(input: {
    email: string;
    url: string;
    token: string;
    metadata?: Record<string, unknown>;
}, request?: Request): Promise<void> {
    const startedAt = Date.now();
    try {
        const configuration = earlyBirdMagicLinkConfiguration();
        if (!configuration) return;
        const email = input.email.trim().toLowerCase();
        const allowed = await consumeEarlyBirdMagicLinkRateLimit({
            email,
            request,
            secret: configuration.rateSecret,
        });
        if (!allowed) return;

        // A magic link may create and later authenticate an email-only Listener,
        // but it must not silently become a second credential for a social or
        // supervised synthetic identity that happens to share the address.
        const account = await prisma.earlyBirdUser.findUnique({
            where: { email },
            select: { identities: { select: { id: true }, take: 1 } },
        });
        if (account?.identities.length) return;

        const expiresAt = new Date(Date.now() + EARLY_BIRD_MAGIC_LINK_TTL_SECONDS * 1_000);
        const idempotencyKey = createHmac('sha256', configuration.rateSecret)
            .update(`listener-magic-link:${hashEarlyBirdMagicLinkToken(input.token)}`)
            .digest('hex');
        await fetch(configuration.url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${configuration.token}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({
                contract_version: 'listener-magic-link.v1',
                purpose: 'listener_sign_in',
                recipient: email,
                locale: localeFromMetadata(input.metadata),
                magic_link_url: input.url,
                expires_at: expiresAt.toISOString(),
            }),
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(5_000),
        }).catch(() => null);
    } finally {
        await waitForGenericResponseFloor(startedAt);
    }
}
