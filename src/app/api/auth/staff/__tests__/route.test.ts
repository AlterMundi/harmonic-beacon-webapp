import { randomBytes, scryptSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, parseResponse } from '@/__tests__/helpers';
import { type StaffDefinition, loadSeedContract } from '../../../../../../prisma/seed-contract';

/**
 * Staff admission, end to end from the seed contract.
 *
 * The credentials here are built the way WS6-03 builds the production ones —
 * per-user salt, scrypt, `scrypt$salt$digest` — run through the real
 * `loadSeedContract`, and verified by the real `verifyStaffPassword`. Nothing
 * about the digest format is stubbed, so a change to it fails here rather than
 * at event time with four people unable to sign in.
 */

const CLIENT = '203.0.113.11';

const PASSWORDS = {
    facilitator: 'julian-weekend-passphrase-1',
    operatorOne: 'operator-one-weekend-passphrase-2',
    operatorTwo: 'operator-two-weekend-passphrase-3',
    admin: 'admin-weekend-passphrase-4',
} as const;

function credentialDigest(password: string): string {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('base64url')}$${scryptSync(password, salt, 32).toString('base64url')}`;
}

function seedEnvironment(): NodeJS.ProcessEnv {
    return {
        NODE_ENV: 'test',
        SESSION_COOKIE_TTL_SECONDS: '604800',
        STAFF_FACILITATOR_NAME: 'Julian',
        STAFF_FACILITATOR_EMAIL: 'Facilitator@example.invalid',
        STAFF_FACILITATOR_PASSWORD_DIGEST: credentialDigest(PASSWORDS.facilitator),
        STAFF_OPERATOR_ONE_NAME: 'Operator One',
        STAFF_OPERATOR_ONE_EMAIL: 'operator-one@example.invalid',
        STAFF_OPERATOR_ONE_PASSWORD_DIGEST: credentialDigest(PASSWORDS.operatorOne),
        STAFF_OPERATOR_TWO_NAME: 'Operator Two',
        STAFF_OPERATOR_TWO_EMAIL: 'operator-two@example.invalid',
        STAFF_OPERATOR_TWO_PASSWORD_DIGEST: credentialDigest(PASSWORDS.operatorTwo),
        STAFF_ADMIN_NAME: 'Weekend Admin',
        STAFF_ADMIN_EMAIL: 'admin@example.invalid',
        STAFF_ADMIN_PASSWORD_DIGEST: credentialDigest(PASSWORDS.admin),
        WEEKEND_SESSION_1_EVENT_JSON: JSON.stringify({
            id: '10000000-0000-4000-8000-000000000001',
            title: 'Saturday session',
            roomName: 'weekend-saturday',
            scheduledAt: '2026-08-08T22:00:00.000Z',
        }),
        WEEKEND_SESSION_2_EVENT_JSON: JSON.stringify({
            id: '10000000-0000-4000-8000-000000000002',
            title: 'Sunday session',
            roomName: 'weekend-sunday',
            scheduledAt: '2026-08-08T22:00:00.000Z',
        }),
    };
}

type UserRow = {
    id: string;
    email: string;
    role: string;
    passwordDigest: string;
    disabledAt: Date | null;
};

type WebSessionRow = {
    id: string;
    tokenDigest: string;
    staffUserId?: string;
    expiresAt: Date;
    revokedAt: Date | null;
};

/** Seed the fake database the way `prisma/seed.ts` seeds the real one. */
function seedUsers(staff: StaffDefinition[]): UserRow[] {
    return staff.map((person, index) => ({
        id: `user-${index + 1}`,
        email: person.email,
        role: person.role,
        passwordDigest: person.passwordDigest,
        disabledAt: null,
    }));
}

function mountDb(users: UserRow[]) {
    const webSessions: WebSessionRow[] = [];

    const prisma = {
        user: {
            findUnique: async ({ where }: { where: { email: string } }) =>
                users.find((user) => user.email === where.email) ?? null,
        },
        webSession: {
            create: async ({ data }: { data: Omit<WebSessionRow, 'id' | 'revokedAt'> }) => {
                const row = { id: `web-session-${webSessions.length + 1}`, revokedAt: null, ...data };
                webSessions.push(row);
                return row;
            },
            // Shaped like the `select` in `@/lib/principal`, so a cookie issued by
            // the route can be resolved back into a principal here.
            findUnique: async ({ where }: { where: { tokenDigest: string } }) => {
                const row = webSessions.find((session) => session.tokenDigest === where.tokenDigest);
                if (!row) return null;
                const staffUser = users.find((user) => user.id === row.staffUserId) ?? null;
                return {
                    id: row.id,
                    tokenDigest: row.tokenDigest,
                    expiresAt: row.expiresAt,
                    revokedAt: row.revokedAt,
                    staffUser: staffUser
                        ? { id: staffUser.id, role: staffUser.role, disabledAt: staffUser.disabledAt }
                        : null,
                    ticketEntitlement: null,
                };
            },
        },
        scheduledSession: {
            findMany: async () => [],
        },
    };

    vi.doMock('@/lib/db', () => ({ prisma, default: prisma }));
    return { prisma, users, webSessions };
}

function loginRequest(body: unknown, address = CLIENT) {
    return createRequest('/api/auth/staff', {
        method: 'POST',
        body,
        headers: { 'x-forwarded-for': address },
    });
}

function sessionCookieOf(response: Response) {
    return (response as unknown as { cookies: { get(name: string): { value: string } | undefined } }).cookies.get(
        'hb_session',
    );
}

describe('POST /api/auth/staff', () => {
    let staff: StaffDefinition[];

    beforeEach(() => {
        vi.resetModules();
        staff = loadSeedContract(seedEnvironment()).staff;
    });

    afterEach(() => {
        vi.doUnmock('@/lib/db');
        vi.restoreAllMocks();
    });

    it('resolves the four seeded credentials to their intended roles', async () => {
        const db = mountDb(seedUsers(staff));
        const { POST } = await importRoute();
        const { principalFromToken } = await import('@/lib/principal');

        const expected = [
            { email: 'facilitator@example.invalid', password: PASSWORDS.facilitator, role: 'FACILITATOR' },
            { email: 'operator-one@example.invalid', password: PASSWORDS.operatorOne, role: 'OPERATOR' },
            { email: 'operator-two@example.invalid', password: PASSWORDS.operatorTwo, role: 'OPERATOR' },
            { email: 'admin@example.invalid', password: PASSWORDS.admin, role: 'ADMIN' },
        ];

        for (const person of expected) {
            const response = await POST(loginRequest({ email: person.email, password: person.password }));
            const { status, body } = await parseResponse(response);

            expect(status).toBe(200);
            expect(body).toEqual({
                ok: true,
                role: person.role,
                landing: '/ops/events',
            });

            // The role the cookie actually resolves to on a later request, which
            // is the one that governs the operator console.
            const cookie = sessionCookieOf(response);
            expect(cookie).toBeDefined();
            const principal = await principalFromToken(cookie!.value);
            expect(principal).toMatchObject({ kind: 'staff', role: person.role });
        }

        expect(db.webSessions).toHaveLength(4);
        // Each person got their own session bound to their own user row.
        expect(new Set(db.webSessions.map((session) => session.staffUserId)).size).toBe(4);
    });

    it('returns and persists FACILITATOR_OP when the facilitator seed explicitly configures it', async () => {
        const env = seedEnvironment();
        env.STAFF_FACILITATOR_ROLE = 'FACILITATOR_OP';
        staff = loadSeedContract(env).staff;
        mountDb(seedUsers(staff));
        const { POST } = await importRoute();
        const { principalFromToken } = await import('@/lib/principal');

        const response = await POST(loginRequest({
            email: 'facilitator@example.invalid',
            password: PASSWORDS.facilitator,
        }));
        expect((await parseResponse(response)).body).toEqual({
            ok: true,
            role: 'FACILITATOR_OP',
            landing: '/ops/events',
        });
        const cookie = sessionCookieOf(response);
        expect(await principalFromToken(cookie!.value)).toMatchObject({
            kind: 'staff',
            role: 'FACILITATOR_OP',
        });
    });

    it('accepts an address typed with different capitalization', async () => {
        mountDb(seedUsers(staff));
        const { POST } = await importRoute();

        const response = await POST(
            loginRequest({ email: '  Admin@Example.INVALID ', password: PASSWORDS.admin }),
        );

        expect(response.status).toBe(200);
    });

    it('denies a wrong password', async () => {
        const db = mountDb(seedUsers(staff));
        const { POST } = await importRoute();

        const response = await POST(loginRequest({ email: 'admin@example.invalid', password: 'not-the-password' }));

        expect(response.status).toBe(401);
        expect(sessionCookieOf(response)).toBeUndefined();
        expect(db.webSessions).toHaveLength(0);
    });

    it('denies a disabled staff account holding the right password', async () => {
        const users = seedUsers(staff);
        users[1].disabledAt = new Date('2026-07-30T00:00:00.000Z');
        const db = mountDb(users);
        const { POST } = await importRoute();

        const response = await POST(
            loginRequest({ email: 'operator-one@example.invalid', password: PASSWORDS.operatorOne }),
        );

        expect(response.status).toBe(401);
        expect(db.webSessions).toHaveLength(0);
    });

    it('answers an unknown address exactly as it answers a wrong password', async () => {
        mountDb(seedUsers(staff));
        const { POST } = await importRoute();

        const unknown = await POST(loginRequest({ email: 'nobody@example.invalid', password: PASSWORDS.admin }));
        const wrongPassword = await POST(loginRequest({ email: 'admin@example.invalid', password: 'wrong' }));

        expect(unknown.status).toBe(401);
        expect(wrongPassword.status).toBe(401);
        expect(await unknown.json()).toEqual(await wrongPassword.json());
    });

    it('derives a key even for an unknown address, so response time is not an oracle', async () => {
        const db = mountDb(seedUsers(staff));
        const sessionAuth = await import('@/lib/session-auth');
        const spy = vi.fn(sessionAuth.verifyStaffPassword);
        vi.doMock('@/lib/session-auth', () => ({ ...sessionAuth, verifyStaffPassword: spy }));

        vi.resetModules();
        const { POST } = await importRoute();
        await POST(loginRequest({ email: 'nobody@example.invalid', password: 'guess' }));

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][1]).toMatch(/^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
        expect(db.webSessions).toHaveLength(0);
        vi.doUnmock('@/lib/session-auth');
    });

    it('rejects a malformed request without a database lookup', async () => {
        const db = mountDb(seedUsers(staff));
        const findUnique = vi.spyOn(db.prisma.user, 'findUnique');
        const { POST } = await importRoute();

        for (const body of [{}, { email: 'admin@example.invalid' }, { password: 'x' }, { email: 'nope', password: 'x' }]) {
            expect((await POST(loginRequest(body))).status).toBe(400);
        }
        expect(findUnique).not.toHaveBeenCalled();
    });

    it('shares the failed-attempt budget with the ticket endpoint', async () => {
        mountDb(seedUsers(staff));
        const { POST: staffPost } = await importRoute();
        const { authFailureLimiter, AUTH_FAILURE_LIMIT } = await import('@/lib/rate-limit');

        // Nineteen failures spent elsewhere: alternating endpoints must not double
        // an attacker's budget.
        for (let attempt = 0; attempt < AUTH_FAILURE_LIMIT - 1; attempt += 1) {
            authFailureLimiter.recordFailure(CLIENT);
        }

        const twentieth = await staffPost(loginRequest({ email: 'admin@example.invalid', password: 'wrong' }));
        expect(twentieth.status).toBe(401);

        const limited = await staffPost(loginRequest({ email: 'admin@example.invalid', password: PASSWORDS.admin }));
        const { status, body } = await parseResponse(limited);
        expect(status).toBe(429);
        expect(body).toEqual({ error: 'Too many attempts. Please wait and try again.' });
        expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);

        authFailureLimiter.reset();
    });

    it('keeps credentials and addresses out of success and failure logs', async () => {
        mountDb(seedUsers(staff));
        const { POST } = await importRoute();

        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        await POST(loginRequest({ email: 'admin@example.invalid', password: PASSWORDS.admin }));
        await POST(loginRequest({ email: 'admin@example.invalid', password: 'wrong' }));
        await POST(loginRequest({ email: 'nobody@example.invalid', password: 'wrong' }));

        const logged = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]
            .flat()
            .map((entry) => String(entry))
            .join('\n');

        expect(logged).not.toBe('');
        expect(logged).not.toContain('@');
        expect(logged).not.toContain(PASSWORDS.admin);
        expect(logged).not.toContain('Julian');

        // Staff id and role are the roadmap's allowance, and they are enough to
        // answer "who signed in" from the seed record.
        expect(logged).toContain('user=user-4');
        expect(logged).toContain('role=ADMIN');
        expect(logged).toContain('reason=bad_password');
        expect(logged).toContain('reason=unknown_account');
    });
});

async function importRoute() {
    return import('../route');
}
