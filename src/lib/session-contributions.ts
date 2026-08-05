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

/**
 * Page envelope for both feeds. The contract deliberately separates emptying
 * a backlog from polling for new messages:
 *
 * - `hasMore`: the current page was truncated — more rows exist right now.
 * - `nextPageCursor`: where to continue draining the backlog; set only when
 *   `hasMore` is true.
 * - `resumeCursor`: cursor of the last delivered item, usable for incremental
 *   polling even at the tail (`hasMore=false`, `nextPageCursor=null`).
 *
 * An empty page (a poll that finds nothing after the client's cursor)
 * returns zero items with `hasMore=false`, both cursors null — the client
 * keeps polling with the cursor it already had, which stays valid.
 */
export type ContributionsPage<T> = {
    contributions: T[];
    hasMore: boolean;
    nextPageCursor: string | null;
    resumeCursor: string | null;
};

function toPage<TRow extends { createdAt: Date; id: string }, TDto>(
    rows: TRow[],
    limit: number,
    map: (row: TRow) => TDto,
): ContributionsPage<TDto> {
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const resumeCursor = page.length > 0
        ? encodeContributionCursor({
            createdAt: page[page.length - 1].createdAt.toISOString(),
            id: page[page.length - 1].id,
        })
        : null;
    return {
        contributions: page.map(map),
        hasMore,
        nextPageCursor: hasMore ? resumeCursor : null,
        resumeCursor,
    };
}

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
    return toPage(rows, params.limit, toPublicContribution);
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
    return toPage(rows, params.limit, toStaffContribution);
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
 *
 * Ordering is part of the contract:
 *
 *   1. validate and normalize the payload;
 *   2. resolve the participant;
 *   3. look up (session, participant, idempotencyKey);
 *   4. an existing row decides replay (200) or conflict (409) immediately —
 *      neither touches the rate-limit budget, and neither is ever hidden
 *      behind a 429;
 *   5. only a genuinely new key enters the per-participant serialized
 *      section, where idempotency is re-checked (a twin may have created the
 *      row while this request queued), the budget is consulted, and a slot is
 *      reserved before the INSERT;
 *   6. the reservation is kept when a row is created and released when the
 *      INSERT fails or a P2002 turns out to be a replay/conflict.
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

    const uniqueKey = {
        scheduledSessionId_authorParticipantId_idempotencyKey: {
            scheduledSessionId: params.scheduledSessionId,
            authorParticipantId: participant.id,
            idempotencyKey,
        },
    };

    // Fast path, outside any lock: replay and conflict never queue for a
    // rate-limit slot and never see a 429.
    const existing = await prisma.sessionContribution.findUnique({ where: uniqueKey });
    if (existing) {
        return replayOrConflict(existing, requestDigest);
    }

    const limiterKey = `${params.scheduledSessionId}:${participant.id}`;
    return contributionSubmissionLimiter.withSlot(
        limiterKey,
        async (slot) => {
            // Re-check inside the lock: a concurrent request with the same
            // key may have created the row while this one queued. Replay and
            // conflict still spend no budget.
            const winner = await prisma.sessionContribution.findUnique({ where: uniqueKey });
            if (winner) {
                return replayOrConflict(winner, requestDigest);
            }

            if (!slot.isAvailable()) {
                throw new ContributionError(
                    'rate_limited',
                    429,
                    'Too many contributions; wait before sharing again',
                    { retryAfterSeconds: slot.retryAfterSeconds() },
                );
            }

            slot.reserve();
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
                return { contribution: toPublicContribution(created), created: true };
            } catch (error) {
                // A failed INSERT frees the budget slot; so does a P2002 that
                // resolves to replay/conflict. Only a created row keeps it.
                slot.release();
                // The per-process lock serializes same-process writers, so a
                // P2002 here means a cross-process race: the unique index is
                // the only inter-process guarantee. The loser re-reads and
                // replays (or conflicts) canonically.
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                    const raced = await prisma.sessionContribution.findUnique({ where: uniqueKey });
                    if (raced) {
                        return replayOrConflict(raced, requestDigest);
                    }
                }
                throw error;
            }
        },
        params.now?.getTime(),
    );
}
