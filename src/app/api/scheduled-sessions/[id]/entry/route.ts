import { NextRequest, NextResponse } from 'next/server';

import {
    AttendeeDisplayNameError,
    confirmAttendeeDisplayName,
    readAttendeeDisplayName,
} from '@/lib/attendee-display-name';
import { prisma } from '@/lib/db';
import { accountIdentityFromToken, principalFromToken } from '@/lib/principal';
import { attachPublicSessionAccess } from '@/lib/public-session-access';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';
import { eventStaffPolicy } from '@/lib/staff-capabilities';

export const dynamic = 'force-dynamic';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

function response(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE });
}

async function resolveEntry(request: NextRequest, id: string) {
    const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    let principal = await principalFromToken(cookieValue);
    const account = principal ? null : await accountIdentityFromToken(cookieValue);
    if (!principal && !account) {
        return { ok: false as const, error: response({ error: 'Authentication required' }, 401) };
    }

    const session = await prisma.scheduledSession.findUnique({
        where: { id },
        select: {
            id: true,
            title: true,
            language: true,
            scheduledAt: true,
            status: true,
            facilitatorId: true,
            publicAccess: true,
        },
    });
    if (!session) {
        return { ok: false as const, error: response({ error: 'Session not found' }, 404) };
    }

    if (!principal && account && cookieValue && session.publicAccess) {
        const attached = await attachPublicSessionAccess(cookieValue, session, account);
        if (attached) principal = await principalFromToken(cookieValue);
    }
    if (!principal) {
        return { ok: false as const, error: response({ error: 'Not authorized' }, 403) };
    }

    if (principal.kind === 'attendee' && principal.scheduledSessionId !== session.id) {
        return { ok: false as const, error: response({ error: 'Not authorized' }, 403) };
    }
    if (principal.kind === 'staff') {
        const policy = eventStaffPolicy(
            principal.role,
            session.facilitatorId === principal.userId,
        );
        if (!policy.canOperateEvent) {
            return { ok: false as const, error: response({ error: 'Not authorized' }, 403) };
        }
    }

    return { ok: true as const, principal, session };
}

/**
 * Lightweight, non-token entry state. The room page polls this before mounting
 * either LiveKit connection, so a valid ticket can wait truthfully without
 * receiving stage or bed credentials.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const resolved = await resolveEntry(request, id);
    if (!resolved.ok) return resolved.error;
    const { principal, session } = resolved;

    const state = session.status === 'SCHEDULED'
        ? (principal.kind === 'attendee' ? 'WAITING' : 'READY')
        : session.status === 'LIVE'
            ? 'READY'
            : session.status;

    let identity: { kind: 'staff' } | {
        kind: 'attendee';
        displayName: string;
        confirmed: boolean;
    } = { kind: 'staff' };
    if (principal.kind === 'attendee') {
        try {
            const name = await readAttendeeDisplayName(
                principal.webSessionId,
                id,
                principal.entitlementId,
            );
            identity = { kind: 'attendee', ...name };
        } catch (failure) {
            if (failure instanceof AttendeeDisplayNameError) {
                return response({ error: failure.code }, failure.status);
            }
            throw failure;
        }
    }

    return response({
        state,
        identity,
        session: {
            id: session.id,
            title: session.title,
            language: session.language,
            scheduledAt: session.scheduledAt.toISOString(),
            status: session.status,
        },
    });
}

/** Confirm or correct the caller's own room alias before LiveKit is mounted. */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const resolved = await resolveEntry(request, id);
    if (!resolved.ok) return resolved.error;
    if (resolved.principal.kind !== 'attendee') {
        return response({ error: 'Not authorized' }, 403);
    }

    let displayName = '';
    try {
        const body = await request.json() as { displayName?: unknown };
        displayName = typeof body.displayName === 'string' ? body.displayName : '';
    } catch {
        // The shared validator below returns the same bounded client error.
    }

    try {
        return response(await confirmAttendeeDisplayName({
            webSessionId: resolved.principal.webSessionId,
            scheduledSessionId: id,
            ticketEntitlementId: resolved.principal.entitlementId,
            displayName,
        }));
    } catch (failure) {
        if (failure instanceof AttendeeDisplayNameError) {
            return response(
                { error: failure.code, message: failure.message },
                failure.status,
            );
        }
        console.error('[entry] unexpected display-name confirmation failure');
        return response({ error: 'entry_unavailable' }, 500);
    }
}
