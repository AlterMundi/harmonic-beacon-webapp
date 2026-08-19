export const PUBLIC_CYCLE_SESSION_IDS = [
    '50000000-0000-4000-8000-202608220001',
    '50000000-0000-4000-8000-202608290001',
    '50000000-0000-4000-8000-202609050001',
    '50000000-0000-4000-8000-202609120001',
] as const;

const PUBLIC_CYCLE_SESSION_ID_SET = new Set<string>(PUBLIC_CYCLE_SESSION_IDS);

export function isPublicCycleSession(sessionId: string): boolean {
    return PUBLIC_CYCLE_SESSION_ID_SET.has(sessionId);
}

type AnonymousPublicCycleCandidate = {
    staffUser: unknown | null;
    accountIssuer: string | null;
    accountSubject: string | null;
    accountSessionId: string | null;
    accountValidatedAt: Date | null;
    ticketEntitlement: {
        scheduledSessionId: string;
        tier: string;
        codeLastFour: string;
        boundEmail: string | null;
        accountId: string | null;
        accountIssuer: string | null;
        scheduledSession: {
            publicAccess: boolean;
            isTest: boolean;
        };
    } | null;
};

/**
 * The narrow compatibility boundary for the four registration-free rooms.
 * It cannot authorize staff, paid tickets, arbitrary public_access rows or a
 * partially Account-bound session.
 */
export function isAnonymousPublicCycleAccess(candidate: AnonymousPublicCycleCandidate): boolean {
    const ticket = candidate.ticketEntitlement;
    return Boolean(
        candidate.staffUser === null &&
        candidate.accountIssuer === null &&
        candidate.accountSubject === null &&
        candidate.accountSessionId === null &&
        candidate.accountValidatedAt === null &&
        ticket &&
        isPublicCycleSession(ticket.scheduledSessionId) &&
        ticket.tier === 'COMP' &&
        ticket.codeLastFour === 'FREE' &&
        typeof ticket.boundEmail === 'string' &&
        ticket.boundEmail.endsWith('@anonymous.harmonicbeacon.invalid') &&
        ticket.accountId === null &&
        ticket.accountIssuer === null &&
        ticket.scheduledSession.publicAccess &&
        !ticket.scheduledSession.isTest
    );
}
