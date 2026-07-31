/**
 * E2E test dashboard login — TEMPORARY, test-window only.
 *
 * Creates a real weekend session for an ad-hoc principal (attendee or staff)
 * without going through ticket codes or staff passwords, so the crew can
 * impersonate any role with any display name during end-to-end tests.
 *
 * HARD GATE: the route returns 404 unless E2E_DASHBOARD_ENABLED=1 is set in
 * the environment. That variable is only added to the production env file
 * for the duration of the test window and removed with the test-data purge.
 * Never enable it outside a supervised test window.
 */

import { randomBytes } from 'node:crypto';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/db';
import { ticketExpiresAt } from '@/lib/admission';
import {
    isValidDisplayName,
    newSessionToken,
    normalizeDisplayName,
    sessionCookie,
    webSessionExpiry,
} from '@/lib/principal';
import { redactError } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const ROLES = ['ATTENDEE', 'FACILITATOR', 'OPERATOR', 'ADMIN'] as const;
type DashboardRole = (typeof ROLES)[number];

const TEST_ROOM_NAME = 'weekend-test-spanish';
const FACILITATOR_FIXTURE_EMAIL = 'facilitator@altermundi.net';

function enabled(): boolean {
    return process.env.E2E_DASHBOARD_ENABLED === '1';
}

function notFound(): NextResponse {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
}

function slugifyName(name: string): string {
    const slug = name
        .normalize('NFD')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '.');
    return slug.length > 0 ? slug : 'e2e.user';
}

function placeholderPasswordDigest(): string {
    return `scrypt$${randomBytes(16).toString('base64url')}$${randomBytes(32).toString('base64url')}`;
}

function sanitizeLanding(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) {
        return null;
    }
    // Same-origin paths only; block protocol-relative URLs.
    if (!raw.startsWith('/') || raw.startsWith('//')) {
        return null;
    }
    return raw;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!enabled()) {
        return notFound();
    }

    let name: string;
    let role: DashboardRole;
    let landing: string | null;
    try {
        const body = (await request.json()) as unknown;
        const fields = (body ?? {}) as Record<string, unknown>;
        name = typeof fields.name === 'string' ? normalizeDisplayName(fields.name) : '';
        role = ROLES.includes(fields.role as DashboardRole)
            ? (fields.role as DashboardRole)
            : 'ATTENDEE';
        landing = sanitizeLanding(fields.landing);
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }

    if (!isValidDisplayName(name) || !landing) {
        return NextResponse.json(
            { error: 'A name, a role and a same-origin landing path are required.' },
            { status: 400 },
        );
    }

    try {
        const now = new Date();
        let staffUserId: string | null = null;
        let ticketEntitlementId: string | null = null;

        if (role === 'ATTENDEE') {
            const session = await prisma.scheduledSession.findUnique({
                where: { roomName: TEST_ROOM_NAME },
                select: { id: true, scheduledAt: true, status: true },
            });
            if (!session) {
                return NextResponse.json(
                    { error: `Test session ${TEST_ROOM_NAME} not found.` },
                    { status: 409 },
                );
            }
            const ticket = await prisma.ticketEntitlement.create({
                data: {
                    scheduledSessionId: session.id,
                    codeDigest: `e2e-${randomBytes(24).toString('hex')}`,
                    codeLastFour: randomBytes(2).toString('hex').toUpperCase(),
                    tier: 'GLOBAL_NORTH',
                    state: 'BOUND',
                    boundEmail: `${slugifyName(name)}@e2e.altermundi.net`,
                    boundAt: now,
                    expiresAt: ticketExpiresAt(session.scheduledAt, now),
                },
                select: { id: true },
            });
            ticketEntitlementId = ticket.id;
        } else {
            // The facilitator MUST reuse the fixture user: room access checks
            // scheduledSession.facilitatorId against the staff user id.
            const email = role === 'FACILITATOR'
                ? FACILITATOR_FIXTURE_EMAIL
                : `e2e-${role.toLowerCase()}@altermundi.net`;
            const staff = await prisma.user.upsert({
                where: { email },
                update: { name, role, disabledAt: null },
                create: {
                    email,
                    name,
                    role,
                    passwordDigest: placeholderPasswordDigest(),
                },
                select: { id: true },
            });
            staffUserId = staff.id;
        }

        const issued = newSessionToken();
        await prisma.webSession.create({
            data: {
                tokenDigest: issued.database.tokenDigest,
                displayName: name,
                staffUserId,
                ticketEntitlementId,
                expiresAt: webSessionExpiry(now),
                lastSeenAt: now,
            },
        });

        console.info(`[e2e-dashboard] session issued: role=${role} name="${name}" landing=${landing}`);

        const response = NextResponse.json({ ok: true, role, landing });
        response.cookies.set(sessionCookie(issued.cookieValue, now));
        return response;
    } catch (error) {
        console.error(`[e2e-dashboard] login failed: ${redactError(error)}`);
        return NextResponse.json({ error: 'Dashboard login failed.' }, { status: 500 });
    }
}

export async function GET(): Promise<NextResponse> {
    // Probing the endpoint without the gate must look like any other 404.
    return notFound();
}
