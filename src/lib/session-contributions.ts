/**
 * Session contributions (CHAT-01, #137): the questions and emotions feed.
 *
 * Canonical rules implemented here:
 * - One plain-text body holds the question and the emotion together.
 * - Visibility is per message: NAMED shows the room display name to everyone;
 *   ANONYMOUS shows nothing to the audience. Staff with event authority always
 *   see the real author plus how the audience sees the message.
 * - The client never supplies identity. The author is the SessionParticipant
 *   resolved from the authenticated web session and the event entitlement.
 * - Submissions are idempotent per (session, participant, idempotency key):
 *   a replay of the same payload returns the canonical row, a key reused with
 *   a different payload is rejected.
 * - State already includes HIDDEN and WITHDRAWN for CHAT-02; this module only
 *   ever creates VISIBLE rows and ships no transition operations.
 */

import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';
import type { ContributionState, ContributionVisibility, SessionContribution } from '@prisma/client';

import { contributionSubmissionLimiter } from '@/lib/contribution-rate-limit';
import { prisma } from '@/lib/db';

export const CONTRIBUTION_BODY_MAX_CHARS = 1000;
export const CONTRIBUTION_IDEMPOTENCY_KEY_MAX_CHARS = 128;
export const CONTRIBUTIONS_PAGE_DEFAULT_LIMIT = 50;
export const CONTRIBUTIONS_PAGE_MAX_LIMIT = 100;

export class ContributionError extends Error {
    constructor(
        readonly code: string,
        readonly status: number,
        message: string,
        readonly details?: Record<string, unknown>,
    ) {
        super(message);
    }
}

/** What the audience sees. Never carries any author identifier — not even a
 *  null-valued one — so an anonymous message has nothing to leak through. */
export type PublicContribution = {
    id: string;
    body: string;
    /** Room display name for NAMED, `null` for ANONYMOUS (the client
     *  localizes the anonymous label). */
    displayName: string | null;
    visibility: ContributionVisibility;
    createdAt: string;
};

/** What authorized staff sees: the real author and how the audience sees it. */
export type StaffContribution = {
    id: string;
    body: string;
    authorDisplayName: string;
    /** Opaque stable room identity, for correlation with the participants
     *  console staff already operates. Not the ticket id, email or user id. */
    participantIdentity: string;
    visibility: ContributionVisibility;
    audienceAnonymous: boolean;
    state: ContributionState;
    createdAt: string;
};

export function toPublicContribution(row: SessionContribution): PublicContribution {
    return {
        id: row.id,
        body: row.body,
        displayName: row.visibility === 'NAMED' ? row.authorDisplayName : null,
        visibility: row.visibility,
        createdAt: row.createdAt.toISOString(),
    };
}

export function toStaffContribution(
    row: SessionContribution & { authorParticipant: { participantIdentity: string } },
): StaffContribution {
    return {
        id: row.id,
        body: row.body,
        authorDisplayName: row.authorDisplayName,
        participantIdentity: row.authorParticipant.participantIdentity,
        visibility: row.visibility,
        audienceAnonymous: row.visibility === 'ANONYMOUS',
        state: row.state,
        createdAt: row.createdAt.toISOString(),
    };
}

/**
 * Normalize the raw body: NFC so visually identical text digests identically,
 * CRLF/CR collapsed to LF, outer whitespace trimmed. Length counts Unicode
 * code points, not UTF-16 units, so emoji-heavy text is not double-charged.
 * The result is stored as-is; no derived variants are persisted or logged.
 */
export function normalizeContributionBody(raw: unknown): string {
    if (typeof raw !== 'string') {
        throw new ContributionError('invalid_body', 400, 'Body must be a string');
    }
    const normalized = raw.normalize('NFC').replace(/\r\n?/g, '\n').trim();
    if (normalized.length === 0) {
        throw new ContributionError('empty_body', 400, 'Body must not be empty');
    }
    if (Array.from(normalized).length > CONTRIBUTION_BODY_MAX_CHARS) {
        throw new ContributionError(
            'body_too_long',
            400,
            `Body must be at most ${CONTRIBUTION_BODY_MAX_CHARS} characters`,
        );
    }
    return normalized;
}

export function parseContributionVisibility(raw: unknown): ContributionVisibility {
    if (raw === 'NAMED' || raw === 'ANONYMOUS') {
        return raw;
    }
    throw new ContributionError(
        'invalid_visibility',
        400,
        'Visibility must be NAMED or ANONYMOUS',
    );
}

export function parseIdempotencyKey(raw: unknown): string {
    if (typeof raw !== 'string') {
        throw new ContributionError('invalid_idempotency_key', 400, 'Idempotency key must be a string');
    }
    const key = raw.trim();
    if (key.length === 0 || key.length > CONTRIBUTION_IDEMPOTENCY_KEY_MAX_CHARS) {
        throw new ContributionError(
            'invalid_idempotency_key',
            400,
            `Idempotency key must be 1-${CONTRIBUTION_IDEMPOTENCY_KEY_MAX_CHARS} characters`,
        );
    }
    return key;
}

/** Binds the idempotency key to the exact accepted payload. */
export function contributionRequestDigest(
    visibility: ContributionVisibility,
    normalizedBody: string,
): string {
    return createHash('sha256')
        .update(`${visibility}\n${normalizedBody}`, 'utf8')
        .digest('hex');
}

// --- Bounded, stable pagination -------------------------------------------

type ContributionCursor = { createdAt: string; id: string };

export function encodeContributionCursor(cursor: ContributionCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeContributionCursor(raw: string | null): ContributionCursor | null {
    if (raw === null || raw === '') {
        return null;
    }
    try {
        const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
        if (
            typeof parsed !== 'object' || parsed === null ||
            typeof (parsed as ContributionCursor).createdAt !== 'string' ||
            typeof (parsed as ContributionCursor).id !== 'string' ||
            Number.isNaN(Date.parse((parsed as ContributionCursor).createdAt))
        ) {
            throw new Error('invalid shape');
        }
        return parsed as ContributionCursor;
    } catch {
        throw new ContributionError('invalid_cursor', 400, 'Cursor is not valid');
    }
}

export function parseContributionsPageLimit(raw: string | null): number {
    if (raw === null || raw === '') {
        return CONTRIBUTIONS_PAGE_DEFAULT_LIMIT;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > CONTRIBUTIONS_PAGE_MAX_LIMIT) {
        throw new ContributionError(
            'invalid_limit',
            400,
            `Limit must be an integer between 1 and ${CONTRIBUTIONS_PAGE_MAX_LIMIT}`,
        );
    }
    return value;
}

function cursorWhere(cursor: ContributionCursor | null) {
    if (!cursor) {
        return {};
    }
    const createdAt = new Date(cursor.createdAt);
    return {
        OR: [
            { createdAt: { gt: createdAt } },
            { createdAt, id: { gt: cursor.id } },
        ],
    };
}

export type ContributionsPage<T> = {
    contributions: T[];
    nextCursor: string | null;
};

export async function listPublicContributions(params: {
    scheduledSessionId: string;
    cursor: ContributionCursor | null;
    limit: number;
}): Promise<ContributionsPage<PublicContribution>> {
    const rows = await prisma.sessionContribution.findMany({
        where: {
            scheduledSessionId: params.scheduledSessionId,
            state: 'VISIBLE',
            ...cursorWhere(params.cursor),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: params.limit + 1,
    });
    const page = rows.slice(0, params.limit);
    return {
        contributions: page.map(toPublicContribution),
        nextCursor: rows.length > params.limit && page.length > 0
            ? encodeContributionCursor({
                createdAt: page[page.length - 1].createdAt.toISOString(),
                id: page[page.length - 1].id,
            })
            : null,
    };
}

export async function listStaffContributions(params: {
    scheduledSessionId: string;
    cursor: ContributionCursor | null;
    limit: number;
}): Promise<ContributionsPage<StaffContribution>> {
    const rows = await prisma.sessionContribution.findMany({
        where: {
            scheduledSessionId: params.scheduledSessionId,
            state: { in: ['VISIBLE', 'HIDDEN'] },
            ...cursorWhere(params.cursor),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: params.limit + 1,
        include: {
            authorParticipant: { select: { participantIdentity: true } },
        },
    });
    const page = rows.slice(0, params.limit);
    return {
        contributions: page.map(toStaffContribution),
        nextCursor: rows.length > params.limit && page.length > 0
            ? encodeContributionCursor({
                createdAt: page[page.length - 1].createdAt.toISOString(),
                id: page[page.length - 1].id,
            })
            : null,
    };
}

// --- Creation ---------------------------------------------------------------

export type CreateContributionResult = {
    contribution: PublicContribution;
    /** false when the request was an idempotent replay of the canonical row. */
    created: boolean;
};

function replayOrConflict(
    existing: SessionContribution,
    requestDigest: string,
): CreateContributionResult {
    if (existing.requestDigest !== requestDigest) {
        throw new ContributionError(
            'idempotency_key_conflict',
            409,
            'Idempotency key was already used with a different payload',
        );
    }
    return { contribution: toPublicContribution(existing), created: false };
}

/**
 * Create one VISIBLE contribution for an entitled attendee.
 *
 * Identity comes only from the resolved room principal; the participant row
 * is matched by (session, ticket entitlement), so a forged body field cannot
 * attribute the message to anyone else. The attendee must already have a
 * participant row (everyone in the room does — joining materializes it);
 * posting before joining is rejected rather than silently materializing
 * presence, because a write here must not masquerade as a room join.
 */
export async function createContribution(params: {
    scheduledSessionId: string;
    ticketEntitlementId: string;
    displayName: string;
    body: unknown;
    visibility: unknown;
    idempotencyKey: unknown;
    now?: Date;
}): Promise<CreateContributionResult> {
    const visibility = parseContributionVisibility(params.visibility);
    const body = normalizeContributionBody(params.body);
    const idempotencyKey = parseIdempotencyKey(params.idempotencyKey);
    const requestDigest = contributionRequestDigest(visibility, body);

    const participant = await prisma.sessionParticipant.findFirst({
        where: {
            scheduledSessionId: params.scheduledSessionId,
            ticketEntitlementId: params.ticketEntitlementId,
        },
        select: { id: true },
    });
    if (!participant) {
        throw new ContributionError(
            'participant_not_joined',
            409,
            'Join the session before contributing',
        );
    }

    const limiterKey = `${params.scheduledSessionId}:${participant.id}`;
    if (contributionSubmissionLimiter.isLimited(limiterKey)) {
        throw new ContributionError(
            'rate_limited',
            429,
            'Too many contributions; wait before sharing again',
            { retryAfterSeconds: contributionSubmissionLimiter.retryAfterSeconds(limiterKey) },
        );
    }

    const replay = await prisma.sessionContribution.findUnique({
        where: {
            scheduledSessionId_authorParticipantId_idempotencyKey: {
                scheduledSessionId: params.scheduledSessionId,
                authorParticipantId: participant.id,
                idempotencyKey,
            },
        },
    });
    if (replay) {
        return replayOrConflict(replay, requestDigest);
    }

    try {
        const created = await prisma.sessionContribution.create({
            data: {
                scheduledSessionId: params.scheduledSessionId,
                authorParticipantId: participant.id,
                authorDisplayName: params.displayName,
                body,
                visibility,
                idempotencyKey,
                requestDigest,
            },
        });
        contributionSubmissionLimiter.recordSubmission(limiterKey);
        return { contribution: toPublicContribution(created), created: true };
    } catch (error) {
        // Two concurrent first submissions race on the unique key: exactly one
        // inserts, the loser re-reads and replays (or conflicts) canonically.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const winner = await prisma.sessionContribution.findUnique({
                where: {
                    scheduledSessionId_authorParticipantId_idempotencyKey: {
                        scheduledSessionId: params.scheduledSessionId,
                        authorParticipantId: participant.id,
                        idempotencyKey,
                    },
                },
            });
            if (winner) {
                return replayOrConflict(winner, requestDigest);
            }
        }
        throw error;
    }
}
