import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
    earlyBirdUser: { findUnique: vi.fn() },
    earlyBirdIdentity: { count: vi.fn() },
    $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: database }));

import {
    consumeEarlyBirdMagicLinkRateLimit,
    deliverEarlyBirdMagicLink,
    EARLY_BIRD_MAGIC_LINK_DELIVERY_PATH,
    earlyBirdMagicLinkAvailable,
    earlyBirdMagicLinkConfiguration,
    earlyBirdMagicLinkSessionAllowed,
    hashEarlyBirdMagicLinkToken,
} from '../magic-link';

type Bucket = {
    key: string;
    kind: string;
    windowStartedAt: Date;
    attempts: number;
    blockedUntil: Date | null;
    updatedAt: Date;
};

function throttleClient() {
    const buckets = new Map<string, Bucket>();
    const transaction = {
        earlyBirdMagicLinkThrottle: {
            async deleteMany() {
                return { count: 0 };
            },
            async upsert(input: {
                where: { key: string };
                create: Omit<Bucket, 'blockedUntil' | 'updatedAt'>;
            }) {
                const existing = buckets.get(input.where.key);
                if (existing) return { ...existing };
                const created: Bucket = {
                    ...input.create,
                    blockedUntil: null,
                    updatedAt: input.create.windowStartedAt,
                };
                buckets.set(created.key, created);
                return { ...created };
            },
            async update(input: {
                where: { key: string };
                data: Omit<Partial<Bucket>, 'attempts'> & {
                    attempts?: number | { increment: number };
                };
            }) {
                const current = buckets.get(input.where.key)!;
                const attempts = typeof input.data.attempts === 'object'
                    ? current.attempts + input.data.attempts.increment
                    : input.data.attempts ?? current.attempts;
                const next = { ...current, ...input.data, attempts } as Bucket;
                buckets.set(next.key, next);
                return { ...next };
            },
        },
    };
    const client = {
        $transaction: vi.fn(async (operation: (value: typeof transaction) => Promise<boolean>) => (
            operation(transaction)
        )),
    };
    return { buckets, client };
}

describe('EarlyBird email magic link', () => {
    beforeEach(() => {
        vi.stubEnv(
            'EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL',
            `http://pmp-myth-mail:8765${EARLY_BIRD_MAGIC_LINK_DELIVERY_PATH}`,
        );
        vi.stubEnv('EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN', 'delivery-token-with-at-least-32-characters');
        vi.stubEnv('EARLY_BIRDS_MAGIC_LINK_RATE_SECRET', 'rate-secret-with-at-least-32-characters-long');
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('fails closed unless the exact versioned delivery boundary and both secrets are valid', () => {
        expect(earlyBirdMagicLinkAvailable()).toBe(true);
        expect(earlyBirdMagicLinkConfiguration()?.url).toContain(EARLY_BIRD_MAGIC_LINK_DELIVERY_PATH);

        expect(earlyBirdMagicLinkAvailable({
            EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL: 'https://mail.example.test/other',
            EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN: 'delivery-token-with-at-least-32-characters',
            EARLY_BIRDS_MAGIC_LINK_RATE_SECRET: 'rate-secret-with-at-least-32-characters-long',
        })).toBe(false);
        expect(earlyBirdMagicLinkAvailable({
            EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL: `https://user:pass@mail.example.test${EARLY_BIRD_MAGIC_LINK_DELIVERY_PATH}`,
            EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN: 'delivery-token-with-at-least-32-characters',
            EARLY_BIRDS_MAGIC_LINK_RATE_SECRET: 'rate-secret-with-at-least-32-characters-long',
        })).toBe(false);
    });

    it('stores a one-way verifier rather than the raw token', () => {
        const token = 'raw-token-that-must-not-be-persisted';
        const verifier = hashEarlyBirdMagicLinkToken(token);
        expect(verifier).toMatch(/^[a-f0-9]{64}$/);
        expect(verifier).not.toContain(token);
        expect(hashEarlyBirdMagicLinkToken(`${token}-changed`)).not.toBe(verifier);
    });

    it('limits normalized email and origin/IP through HMAC-only durable buckets', async () => {
        const { buckets, client } = throttleClient();
        const request = new Request('https://listen.example.test', {
            headers: {
                origin: 'https://listen.example.test',
                'x-forwarded-for': '203.0.113.44',
            },
        });
        const input = {
            email: 'Listener@Example.Test',
            request,
            secret: 'rate-secret-with-at-least-32-characters-long',
            now: new Date('2026-08-07T10:00:00.000Z'),
            client: client as never,
        };

        await expect(consumeEarlyBirdMagicLinkRateLimit(input)).resolves.toBe(true);
        await expect(consumeEarlyBirdMagicLinkRateLimit({ ...input, email: 'listener@example.test' })).resolves.toBe(true);
        await expect(consumeEarlyBirdMagicLinkRateLimit(input)).resolves.toBe(true);
        await expect(consumeEarlyBirdMagicLinkRateLimit(input)).resolves.toBe(false);

        expect([...buckets.keys()]).toHaveLength(2);
        expect(JSON.stringify([...buckets.entries()])).not.toContain('listener@example.test');
        expect(JSON.stringify([...buckets.entries()])).not.toContain('203.0.113.44');
    });

    it('does not let a prefixed forwarded address manufacture a new throttle bucket', async () => {
        const { buckets, client } = throttleClient();
        const input = {
            email: 'listener@example.test',
            secret: 'rate-secret-with-at-least-32-characters-long',
            now: new Date('2026-08-07T10:00:00.000Z'),
            client: client as never,
        };

        await consumeEarlyBirdMagicLinkRateLimit({
            ...input,
            request: new Request('https://listen.example.test', {
                headers: {
                    origin: 'https://listen.example.test',
                    'x-real-ip': '203.0.113.44',
                    'x-forwarded-for': '198.51.100.1, 203.0.113.44',
                },
            }),
        });
        await consumeEarlyBirdMagicLinkRateLimit({
            ...input,
            request: new Request('https://listen.example.test', {
                headers: {
                    origin: 'https://listen.example.test',
                    'x-real-ip': '203.0.113.44',
                    'x-forwarded-for': '198.51.100.2, 203.0.113.44',
                },
            }),
        });

        expect([...buckets.keys()]).toHaveLength(2);
        expect(JSON.stringify([...buckets.entries()])).not.toContain('198.51.100');
        expect(JSON.stringify([...buckets.entries()])).not.toContain('203.0.113.44');
    });

    it('never lets magic-link verification become a credential for a social identity', async () => {
        const noIdentity = { earlyBirdIdentity: { count: vi.fn().mockResolvedValue(0) } };
        const socialIdentity = { earlyBirdIdentity: { count: vi.fn().mockResolvedValue(1) } };

        await expect(earlyBirdMagicLinkSessionAllowed(
            'listener-1', '/magic-link/verify', noIdentity as never,
        )).resolves.toBe(true);
        await expect(earlyBirdMagicLinkSessionAllowed(
            'listener-1', '/magic-link/verify', socialIdentity as never,
        )).resolves.toBe(false);
        await expect(earlyBirdMagicLinkSessionAllowed(
            'listener-1', '/callback/google', socialIdentity as never,
        )).resolves.toBe(true);
    });

    it('sends the minimal authenticated contract without exposing the raw token in headers', async () => {
        const { client } = throttleClient();
        database.$transaction.mockImplementation(client.$transaction);
        database.earlyBirdUser.findUnique.mockResolvedValue(null);
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ status: 'accepted' }), { status: 202 }),
        );
        const token = 'one-use-link-token';

        await deliverEarlyBirdMagicLink({
            email: 'Listener@Example.Test',
            url: `https://listen.example.test/api/early-birds/auth/magic-link/verify?token=${token}`,
            token,
            metadata: { locale: 'es', ignored: 'value' },
        }, new Request('https://listen.example.test', {
            headers: { origin: 'https://listen.example.test', 'x-real-ip': '203.0.113.9' },
        }));

        expect(fetchMock).toHaveBeenCalledOnce();
        const [endpoint, init] = fetchMock.mock.calls[0];
        expect(endpoint).toContain(EARLY_BIRD_MAGIC_LINK_DELIVERY_PATH);
        expect(JSON.stringify(init?.headers)).not.toContain(token);
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
            contract_version: 'listener-magic-link.v1',
            purpose: 'listener_sign_in',
            recipient: 'listener@example.test',
            locale: 'es',
        });
        expect(body.magic_link_url).toContain(token);
        expect(body).not.toHaveProperty('metadata');
    });

    it('returns the same way without delivery for an email owned by another identity', async () => {
        const { client } = throttleClient();
        database.$transaction.mockImplementation(client.$transaction);
        database.earlyBirdUser.findUnique.mockResolvedValue({ identities: [{ id: 'google-identity' }] });
        const fetchMock = vi.spyOn(globalThis, 'fetch');

        await expect(deliverEarlyBirdMagicLink({
            email: 'social@example.test',
            url: 'https://listen.example.test/verify?token=hidden',
            token: 'hidden',
        })).resolves.toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
