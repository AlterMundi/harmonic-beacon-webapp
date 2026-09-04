import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { isValidDisplayName, normalizeDisplayName } from '@/lib/principal';

export type AttendeeDisplayNameState = {
    displayName: string;
    confirmed: boolean;
};

export class AttendeeDisplayNameError extends Error {
    constructor(
        public readonly code: 'invalid_name' | 'not_authorized',
        public readonly status: 400 | 403,
        message: string,
    ) {
        super(message);
        this.name = 'AttendeeDisplayNameError';
    }
}

/** Read the alias the room will actually use, without materializing presence. */
export async function readAttendeeDisplayName(
    webSessionId: string,
    scheduledSessionId: string,
    ticketEntitlementId: string,
): Promise<AttendeeDisplayNameState> {
    const [webSession, participant] = await Promise.all([
        prisma.webSession.findFirst({
            where: {
                id: webSessionId,
                ticketEntitlementId,
                revokedAt: null,
            },
            select: {
                displayName: true,
                displayNameConfirmedAt: true,
            },
        }),
        prisma.sessionParticipant.findFirst({
            where: { scheduledSessionId, ticketEntitlementId },
            select: { displayName: true },
        }),
    ]);
    if (!webSession) {
        throw new AttendeeDisplayNameError(
            'not_authorized',
            403,
            'The attendee session is not authorized',
        );
    }

    const confirmedWebName = webSession.displayNameConfirmedAt !== null
        ? webSession.displayName?.trim()
        : null;
    const displayName = normalizeDisplayName(
        confirmedWebName || participant?.displayName?.trim() || webSession.displayName?.trim() || '',
    );
    return {
        displayName,
        confirmed: webSession.displayNameConfirmedAt !== null && isValidDisplayName(displayName),
    };
}

/**
 * Confirm one browser session and converge every active session plus the
 * durable room participant on the same event alias. The entitlement row is
 * the mutex, so simultaneous corrections from two devices have one winner.
 */
export async function confirmAttendeeDisplayName(input: {
    webSessionId: string;
    scheduledSessionId: string;
    ticketEntitlementId: string;
    displayName: string;
    now?: Date;
}): Promise<AttendeeDisplayNameState> {
    const normalizedCandidate = input.displayName.trim().replace(/\s+/g, ' ');
    const displayName = normalizeDisplayName(input.displayName);
    if (normalizedCandidate.length > 60 || !isValidDisplayName(displayName)) {
        throw new AttendeeDisplayNameError(
            'invalid_name',
            400,
            'A visible name between 1 and 60 characters is required',
        );
    }
    const now = input.now ?? new Date();

    await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(
            Prisma.sql`
                SELECT "id"
                FROM "ticket_entitlements"
                WHERE "id"::text = ${input.ticketEntitlementId}
                FOR UPDATE
            `,
        );

        const current = await transaction.webSession.findFirst({
            where: {
                id: input.webSessionId,
                ticketEntitlementId: input.ticketEntitlementId,
                revokedAt: null,
                expiresAt: { gt: now },
            },
            select: { id: true },
        });
        if (!current) {
            throw new AttendeeDisplayNameError(
                'not_authorized',
                403,
                'The attendee session is not authorized',
            );
        }

        // Other active devices inherit the corrected alias, but each device
        // still confirms deliberately before its own first room connection.
        await transaction.webSession.updateMany({
            where: {
                ticketEntitlementId: input.ticketEntitlementId,
                revokedAt: null,
                expiresAt: { gt: now },
            },
            data: { displayName },
        });
        await transaction.webSession.update({
            where: { id: input.webSessionId },
            data: { displayNameConfirmedAt: now },
        });
        await transaction.sessionParticipant.updateMany({
            where: {
                scheduledSessionId: input.scheduledSessionId,
                ticketEntitlementId: input.ticketEntitlementId,
            },
            data: { displayName },
        });
    });

    return { displayName, confirmed: true };
}
