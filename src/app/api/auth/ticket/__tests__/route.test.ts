import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { createRequest, parseResponse } from '@/__tests__/helpers';
import { digestSessionToken } from '@/lib/session-auth';
import { digestTicketCode } from '@/lib/ticket-code';

/**
 * Attendee admission.
 *
 * `TICKET_CODE_PEPPER` is stubbed rather than assigned, and unstubbed after every
 * test: `ticket-code.test.ts` asserts the pepper's absence is fatal, and vitest
 * workers share one `process.env`.
 */
const PEPPER = 'route-test-pepper-with-at-least-32-characters';
const CODE = 'HB26-A7NQ-92KM-4XZP';
const OTHER_CODE = 'HB26-ZZZZ-0000-9YQT';
const EMAIL = 'ana@example.com';
const NAME = 'Ana';
const CLIENT = '203.0.113.9';

type EntitlementRow = {
    id: string;
    codeDigest: string;
    scheduledSessionId: string;
    codeLastFour: string;
    tier: string;
    state: 'ISSUED' | 'BOUND' | 'REVOKED' | 'EXPIRED';
    boundEmail: string | null;
    boundAt: Date | null;
    expiresAt: Date;
    revokedAt: Date | null;
};

function ticketRow(overrides: Partial<EntitlementRow> = {}): EntitlementRow {
    return {
        id: 'ticket-1',
        codeDigest: digestTicketCode(CODE, PEPPER),
        scheduledSessionId: 'session-saturday',
        codeLastFour: '4XZP',
        tier: 'GLOBAL_NORTH',
        state: 'ISSUED',
        boundEmail: null,
        boundAt: null,
        expiresAt: new Date('2026-08-05T00:00:00.000Z'),
        revokedAt: null,
        ...overrides,
    };
}

type WebSessionRow = {
    tokenDigest: string;
    displayName?: string;
    ticketEntitlementId?: string;
    expiresAt: Date;
};

type FakePrisma = {
    $transaction: <T>(fn: (tx: FakePrisma) => Promise<T>) => Promise<T>;
    $queryRaw: () => Promise<Array<{ id: string }>>;
    ticketEntitlement: {
        findUnique: (args: { where: Record<string, unknown> }) => Promise<EntitlementRow | null>;
        updateMany: (args: {
            where: Record<string, unknown>;
            data: Partial<EntitlementRow>;
        }) => Promise<{ count: number }>;
    };
    webSession: {
        create: (args: { data: WebSessionRow }) => Promise<WebSessionRow & { id: string }>;
    };
};

/**
 * In-memory stand-in for the entitlement table.
 *
 * `findUnique` defers to a macrotask so two concurrent redemptions really do both
 * read before either writes — the interleaving the transaction has to survive.
 * `updateMany` is atomic within the single-threaded fake, which is what Postgres
 * row locking gives the real thing.
 */
function createFakeDb(rows: EntitlementRow[]) {
    const entitlements = rows.map((row) => ({ ...row }));
    const webSessions: WebSessionRow[] = [];

    function matches(where: Record<string, unknown>, row: EntitlementRow): boolean {
        if (where.codeDigest !== undefined && row.codeDigest !== where.codeDigest) return false;
        if (where.id !== undefined && row.id !== where.id) return false;
        if (where.state !== undefined && row.state !== where.state) return false;
        if (where.boundEmail !== undefined && row.boundEmail !== where.boundEmail) return false;
        if (where.revokedAt !== undefined && row.revokedAt !== where.revokedAt) return false;
        return true;
    }

    const prisma: FakePrisma = {
        $transaction: async (fn) => fn(prisma),
        $queryRaw: async () => [],
        ticketEntitlement: {
            findUnique: async ({ where }) => {
                await new Promise((resolve) => setTimeout(resolve, 0));
                return entitlements.find((row) => matches(where, row)) ?? null;
            },
            updateMany: async ({ where, data }) => {
                const row = entitlements.find((candidate) => matches(where, candidate));
                if (!row) return { count: 0 };
                Object.assign(row, data);
                return { count: 1 };
            },
        },
        webSession: {
            create: async ({ data }) => {
                webSessions.push(data);
                return { id: `web-session-${webSessions.length}`, ...data };
            },
        },
    };

    return { prisma, entitlements, webSessions };
}

function mountDb(rows: EntitlementRow[]) {
    const fake = createFakeDb(rows);
    vi.doMock('@/lib/db', () => ({ prisma: fake.prisma, default: fake.prisma }));
    return fake;
}

function loginRequest(body: unknown, address = CLIENT) {
    const namedBody = body && typeof body === 'object' && !Array.isArray(body)
        ? { name: NAME, ...body as Record<string, unknown> }
        : body;
    return createRequest('/api/auth/ticket', {
        method: 'POST',
        body: namedBody,
        headers: { 'x-forwarded-for': address },
    });
}

function invitationRequest(overrides: Record<string, string> = {}, address = CLIENT) {
    // Production reverse-proxy requests reach Next.js with this internal
    // origin; redirects must never expose it to the attendee.
    return new NextRequest('http://0.0.0.0:3000/api/auth/ticket', {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-forwarded-for': address,
        },
        body: new URLSearchParams({
            name: NAME,
            email: EMAIL,
            code: 'NICO100',
            termsAccepted: 'accepted',
            ...overrides,
        }),
    });
}

async function importRoute() {
    return import('../route');
}

/** The cookie a successful response asks the browser to store. */
function sessionCookieOf(response: Response) {
    return (response as unknown as { cookies: { get(name: string): { value: string } | undefined } }).cookies.get(
        'hb_session',
    );
}

describe('POST /api/auth/ticket', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('TICKET_CODE_PEPPER', PEPPER);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.doUnmock('@/lib/db');
        vi.doUnmock('@/lib/promo-invitation');
        vi.restoreAllMocks();
    });

    it('keeps short invitation codes disabled by default without revealing whether they exist', async () => {
        const db = mountDb([]);
        const { POST } = await importRoute();

        const response = await POST(loginRequest({ code: 'NICO100', email: EMAIL }, '203.0.113.81'));

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'That ticket code and email do not match an active ticket.' });
        expect(db.webSessions).toHaveLength(0);
    });

    it('returns the ordinary attendee cookie/session response for an enabled promotion', async () => {
        const redeemPromoInvitation = vi.fn().mockResolvedValue({
            ok: true,
            scheduledSessionId: 'session-saturday',
            entitlementId: 'promo-entitlement-1',
            codeLastFour: '7XQP',
            cookieValue: 'promo-cookie-value',
            replayed: false,
        });
        vi.doMock('@/lib/promo-invitation', () => ({
            isPlausiblePromoCode: (code: string) => code.trim().toUpperCase() === 'NICO100',
            promoInvitationsEnabled: () => true,
            redeemPromoInvitation,
        }));
        mountDb([]);
        const { POST } = await importRoute();

        const response = await POST(loginRequest({ code: 'nico100', email: EMAIL }, '203.0.113.82'));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, scheduledSessionId: 'session-saturday' });
        expect(redeemPromoInvitation).toHaveBeenCalledWith('NICO100', EMAIL, NAME);
        expect(sessionCookieOf(response)).toMatchObject({
            name: 'hb_session',
            value: 'promo-cookie-value',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
        });
    });

    it('redeems the public invitation form, audits terms, sets the cookie and redirects to its event', async () => {
        const redeemPromoInvitation = vi.fn().mockResolvedValue({
            ok: true,
            scheduledSessionId: '10000000-0000-4000-8000-000000000001',
            entitlementId: 'promo-entitlement-1',
            codeLastFour: '7XQP',
            cookieValue: 'promo-cookie-value',
            replayed: false,
        });
        vi.doMock('@/lib/promo-invitation', () => ({
            isPlausiblePromoCode: (code: string) => code === 'NICO100',
            promoInvitationsEnabled: () => true,
            redeemPromoInvitation,
        }));
        mountDb([]);
        const { POST } = await importRoute();

        const response = await POST(invitationRequest());

        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(
            'https://live.harmonicbeacon.com/session/10000000-0000-4000-8000-000000000001',
        );
        expect(redeemPromoInvitation).toHaveBeenCalledWith(
            'NICO100',
            EMAIL,
            NAME,
            expect.any(Date),
            { version: 'personal-invitation-v2', acceptedAt: expect.any(Date) },
        );
        expect(sessionCookieOf(response)).toMatchObject({
            value: 'promo-cookie-value',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
        });
    });

    it('returns malformed invitation forms to the landing without reflecting PII', async () => {
        mountDb([]);
        const { POST } = await importRoute();

        const malformed: Array<Record<string, string>> = [
            { name: '' },
            { email: 'not-an-email' },
            { termsAccepted: '' },
            { code: CODE },
        ];
        for (const [index, overrides] of malformed.entries()) {
            const response = await POST(invitationRequest(overrides, `198.51.100.${30 + index}`));
            expect(response.status).toBe(303);
            expect(response.headers.get('location')).toBe(
                'https://harmonicbeacon.com/invitacion/?entry_error=invalid',
            );
            expect(response.headers.get('location')).not.toContain(EMAIL);
        }
    });

    it('binds the ticket on first use and returns the secure hb_session cookie', async () => {
        const db = mountDb([ticketRow()]);
        const { POST } = await importRoute();

        const response = await POST(loginRequest({ code: CODE, email: EMAIL }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual({ ok: true, scheduledSessionId: 'session-saturday' });

        expect(db.entitlements[0]).toMatchObject({ state: 'BOUND', boundEmail: EMAIL });
        expect(db.entitlements[0].boundAt).toBeInstanceOf(Date);

        const cookie = sessionCookieOf(response);
        expect(cookie).toMatchObject({
            name: 'hb_session',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
        });
        expect(cookie!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

        // Only the digest is persisted, and it is the digest of the cookie the
        // browser was given.
        expect(db.webSessions).toHaveLength(1);
        expect(db.webSessions[0].tokenDigest).toBe(digestSessionToken(cookie!.value));
        expect(JSON.stringify(db.webSessions[0])).not.toContain(cookie!.value);
        expect(db.webSessions[0].ticketEntitlementId).toBe('ticket-1');
        expect(db.webSessions[0].displayName).toBe(NAME);
    });

    it('normalizes the bound email so a refresh and a later login both work', async () => {
        const db = mountDb([ticketRow()]);
        const { POST } = await importRoute();

        const first = await POST(loginRequest({
            name: '  Ana   María  ',
            code: `  ${CODE.toLowerCase()} `,
            email: '  Ana@Example.COM ',
        }));
        expect(first.status).toBe(200);
        expect(db.entitlements[0].boundEmail).toBe(EMAIL);
        expect(db.webSessions[0].displayName).toBe('Ana María');

        // A second login — new browser, new tab, or a reconnect after the laptop
        // slept — issues a second session for the same ticket.
        const second = await POST(loginRequest({ code: CODE, email: 'ANA@example.com' }));
        expect(second.status).toBe(200);
        expect(db.webSessions).toHaveLength(2);
        expect(sessionCookieOf(second)!.value).not.toBe(sessionCookieOf(first)!.value);
        expect(db.entitlements[0].boundEmail).toBe(EMAIL);
    });

    it('lets exactly one of two concurrent first-use requests win', async () => {
        const db = mountDb([ticketRow()]);
        const { POST } = await importRoute();

        const [first, second] = await Promise.all([
            POST(loginRequest({ code: CODE, email: 'ana@example.com' })),
            POST(loginRequest({ code: CODE, email: 'beto@example.com' })),
        ]);

        const statuses = [first.status, second.status].sort();
        expect(statuses).toEqual([200, 401]);

        // One binding, one session. The loser gets neither.
        expect(db.webSessions).toHaveLength(1);
        expect(db.entitlements[0].state).toBe('BOUND');
        expect(['ana@example.com', 'beto@example.com']).toContain(db.entitlements[0].boundEmail);

        const winner = first.status === 200 ? first : second;
        const loser = first.status === 200 ? second : first;
        expect(sessionCookieOf(winner)).toBeDefined();
        expect(sessionCookieOf(loser)).toBeUndefined();

        // And the loser learns nothing a stranger guessing codes would not.
        const nonexistent = await POST(loginRequest({ code: OTHER_CODE, email: 'beto@example.com' }));
        expect(loser.status).toBe(nonexistent.status);
        expect(await loser.json()).toEqual(await nonexistent.json());
    });

    it('lets both concurrent requests in when they carry the same normalized email', async () => {
        const db = mountDb([ticketRow()]);
        const { POST } = await importRoute();

        const [first, second] = await Promise.all([
            POST(loginRequest({ code: CODE, email: 'ana@example.com' })),
            POST(loginRequest({ code: CODE, email: ' Ana@Example.com ' })),
        ]);

        expect([first.status, second.status]).toEqual([200, 200]);
        expect(db.webSessions).toHaveLength(2);
    });

    it('denies the wrong email for a bound ticket', async () => {
        const db = mountDb([ticketRow({ state: 'BOUND', boundEmail: EMAIL, boundAt: new Date() })]);
        const { POST } = await importRoute();

        const response = await POST(loginRequest({ code: CODE, email: 'someone-else@example.com' }));

        expect(response.status).toBe(401);
        expect(db.webSessions).toHaveLength(0);
        expect(db.entitlements[0].boundEmail).toBe(EMAIL);
    });

    it('denies a revoked ticket', async () => {
        const db = mountDb([
            ticketRow({ state: 'REVOKED', boundEmail: EMAIL, revokedAt: new Date('2026-07-31T00:00:00.000Z') }),
        ]);
        const { POST } = await importRoute();

        const response = await POST(loginRequest({ code: CODE, email: EMAIL }));

        expect(response.status).toBe(401);
        expect(db.webSessions).toHaveLength(0);
    });

    it('denies an expired ticket', async () => {
        const db = mountDb([
            ticketRow({ state: 'BOUND', boundEmail: EMAIL, expiresAt: new Date('2026-07-01T00:00:00.000Z') }),
        ]);
        const { POST } = await importRoute();

        expect((await POST(loginRequest({ code: CODE, email: EMAIL }))).status).toBe(401);
        expect(db.webSessions).toHaveLength(0);
    });

    it('answers a nonexistent code exactly as it answers a wrong email', async () => {
        mountDb([ticketRow({ state: 'BOUND', boundEmail: EMAIL })]);
        const { POST } = await importRoute();

        const unknownCode = await POST(loginRequest({ code: OTHER_CODE, email: EMAIL }));
        const wrongEmail = await POST(loginRequest({ code: CODE, email: 'stranger@example.com' }));

        expect(unknownCode.status).toBe(401);
        expect(wrongEmail.status).toBe(401);
        expect(await unknownCode.json()).toEqual(await wrongEmail.json());
    });

    it('rejects a malformed request without consulting the database', async () => {
        const db = mountDb([ticketRow()]);
        const { POST } = await importRoute();

        for (const body of [
            {},
            { code: CODE },
            { email: EMAIL },
            { code: 'SHORT', email: EMAIL },
            { code: CODE, email: 'not-an-email' },
            { code: 12345, email: EMAIL },
        ]) {
            expect((await POST(loginRequest(body))).status).toBe(400);
        }
        expect((await POST(createRequest('/api/auth/ticket', {
            method: 'POST',
            body: { code: CODE, email: EMAIL },
            headers: { 'x-forwarded-for': CLIENT },
        }))).status).toBe(400);
        expect(db.webSessions).toHaveLength(0);
        expect(db.entitlements[0].state).toBe('ISSUED');
    });

    it('reports a missing pepper as an outage rather than a bad code', async () => {
        vi.stubEnv('TICKET_CODE_PEPPER', '');
        mountDb([ticketRow()]);
        const { POST } = await importRoute();

        const { status, body } = await parseResponse(await POST(loginRequest({ code: CODE, email: EMAIL })));

        // 401 here would send operators looking for a ticket problem while every
        // attendee is locked out.
        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Login is temporarily unavailable.' });
    });

    it('returns 500, not a rejection, when the database is unreachable', async () => {
        const prisma = {
            $transaction: vi.fn().mockRejectedValue(new Error('connection refused')),
        };
        vi.doMock('@/lib/db', () => ({ prisma, default: prisma }));
        const { POST } = await importRoute();

        expect((await POST(loginRequest({ code: CODE, email: EMAIL }))).status).toBe(500);
    });

    it('answers 429 after twenty failed attempts from one client address', async () => {
        mountDb([ticketRow({ state: 'BOUND', boundEmail: EMAIL })]);
        const { POST } = await importRoute();

        for (let attempt = 0; attempt < 20; attempt += 1) {
            const response = await POST(loginRequest({ code: CODE, email: `guess-${attempt}@example.com` }));
            expect(response.status).toBe(401);
        }

        const limited = await POST(loginRequest({ code: CODE, email: 'guess-21@example.com' }));
        const { status, body } = await parseResponse(limited);
        expect(status).toBe(429);
        expect(body).toEqual({ error: 'Too many attempts. Please wait and try again.' });
        expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);

        // The budget is per client address: the real attendee behind a different
        // address is unaffected by someone else's guessing.
        const elsewhere = await POST(loginRequest({ code: CODE, email: EMAIL }, '198.51.100.7'));
        expect(elsewhere.status).toBe(200);

        // And a valid code is refused too while the budget is gone — the limit is
        // on the address, not on the guess.
        expect((await POST(loginRequest({ code: CODE, email: EMAIL }))).status).toBe(429);
    });

    it('does not spend the budget on successful logins', async () => {
        mountDb([ticketRow({ state: 'BOUND', boundEmail: EMAIL })]);
        const { POST } = await importRoute();

        for (let attempt = 0; attempt < 25; attempt += 1) {
            expect((await POST(loginRequest({ code: CODE, email: EMAIL }))).status).toBe(200);
        }
    });

    it('keeps the code and the email out of both success and failure logs', async () => {
        mountDb([ticketRow()]);
        const { POST } = await importRoute();

        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        await POST(loginRequest({ code: CODE, email: EMAIL }));
        await POST(loginRequest({ code: CODE, email: 'stranger@example.com' }));
        await POST(loginRequest({ code: OTHER_CODE, email: EMAIL }));

        const logged = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]
            .flat()
            .map((entry) => String(entry))
            .join('\n');

        expect(logged).not.toBe('');
        expect(logged).not.toContain(CODE);
        expect(logged).not.toContain(CODE.toLowerCase());
        expect(logged).not.toContain(OTHER_CODE);
        expect(logged).not.toContain(EMAIL);
        expect(logged).not.toContain('stranger@example.com');
        expect(logged).not.toContain('@');

        // What is there instead: the ticket id, its last four, and the reason.
        expect(logged).toContain('ticket-1');
        expect(logged).toContain('4XZP');
        expect(logged).toContain('reason=email_mismatch');
        expect(logged).toContain('reason=unknown_code');
    });
});
