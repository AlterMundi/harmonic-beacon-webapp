import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

export const AMPLIFICATION_CREDIT_FEED_SCHEMA = 'amplification-credit-entries.v1' as const;
export const AMPLIFICATION_CREDIT_FEED_DEFAULT_LIMIT = 50;
export const AMPLIFICATION_CREDIT_FEED_MAX_LIMIT = 100;

const CURSOR_MAX_CHARS = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class AmplificationCreditFeedError extends Error {
    constructor(
        public readonly code: 'invalid_cursor' | 'invalid_limit' | 'invalid_request',
        public readonly status: 400,
        message: string,
    ) {
        super(message);
        this.name = 'AmplificationCreditFeedError';
    }
}

export type AmplificationCreditEntry = {
    entry_id: string;
    scheduled_session_id: string;
    ticket_entitlement_id: string;
    registration_id: string | null;
    email: string | null;
    display_name: string | null;
    entered_at: string;
};

export type AmplificationCreditFeedPage = {
    schema_version: typeof AMPLIFICATION_CREDIT_FEED_SCHEMA;
    entries: AmplificationCreditEntry[];
    next_cursor: string | null;
};

export type AmplificationCreditCursor = {
    v: 1;
    entered_at: string;
    entry_id: string;
};

type AmplificationCreditDatabaseRow = {
    entry_id: string;
    scheduled_session_id: string;
    ticket_entitlement_id: string;
    registration_id: string | null;
    email: string | null;
    display_name: string | null;
    entered_at: Date;
};

function invalidCursor(): never {
    throw new AmplificationCreditFeedError('invalid_cursor', 400, 'Cursor is not valid');
}

export function encodeAmplificationCreditCursor(cursor: AmplificationCreditCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeAmplificationCreditCursor(raw: string | null): AmplificationCreditCursor | null {
    if (raw === null) return null;
    if (raw.length === 0 || raw.length > CURSOR_MAX_CHARS || !BASE64URL.test(raw)) {
        return invalidCursor();
    }

    try {
        const decoded = Buffer.from(raw, 'base64url');
        if (decoded.toString('base64url') !== raw) return invalidCursor();
        const parsed = JSON.parse(decoded.toString('utf8')) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return invalidCursor();
        }
        const record = parsed as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        if (
            keys.length !== 3 ||
            keys[0] !== 'entered_at' ||
            keys[1] !== 'entry_id' ||
            keys[2] !== 'v' ||
            record.v !== 1 ||
            typeof record.entered_at !== 'string' ||
            typeof record.entry_id !== 'string' ||
            !UUID.test(record.entry_id)
        ) {
            return invalidCursor();
        }
        const instant = new Date(record.entered_at);
        if (Number.isNaN(instant.getTime()) || instant.toISOString() !== record.entered_at) {
            return invalidCursor();
        }
        return {
            v: 1,
            entered_at: record.entered_at,
            entry_id: record.entry_id,
        };
    } catch (error) {
        if (error instanceof AmplificationCreditFeedError) throw error;
        return invalidCursor();
    }
}

export function parseAmplificationCreditFeedLimit(raw: string | null): number {
    if (raw === null) return AMPLIFICATION_CREDIT_FEED_DEFAULT_LIMIT;
    if (!/^[1-9][0-9]{0,2}$/.test(raw)) {
        throw new AmplificationCreditFeedError(
            'invalid_limit',
            400,
            `Limit must be an integer between 1 and ${AMPLIFICATION_CREDIT_FEED_MAX_LIMIT}`,
        );
    }
    const limit = Number(raw);
    if (limit > AMPLIFICATION_CREDIT_FEED_MAX_LIMIT) {
        throw new AmplificationCreditFeedError(
            'invalid_limit',
            400,
            `Limit must be an integer between 1 and ${AMPLIFICATION_CREDIT_FEED_MAX_LIMIT}`,
        );
    }
    return limit;
}

export function parseAmplificationCreditFeedQuery(searchParams: URLSearchParams): {
    cursor: AmplificationCreditCursor | null;
    limit: number;
} {
    for (const key of searchParams.keys()) {
        if (key !== 'cursor' && key !== 'limit') {
            throw new AmplificationCreditFeedError('invalid_request', 400, 'Unknown query parameter');
        }
    }
    if (searchParams.getAll('cursor').length > 1 || searchParams.getAll('limit').length > 1) {
        throw new AmplificationCreditFeedError('invalid_request', 400, 'Query parameters must not repeat');
    }
    return {
        cursor: decodeAmplificationCreditCursor(searchParams.get('cursor')),
        limit: parseAmplificationCreditFeedLimit(searchParams.get('limit')),
    };
}

function mapRow(row: AmplificationCreditDatabaseRow): AmplificationCreditEntry {
    return {
        entry_id: row.entry_id,
        scheduled_session_id: row.scheduled_session_id,
        ticket_entitlement_id: row.ticket_entitlement_id,
        registration_id: row.registration_id,
        email: row.email,
        display_name: row.display_name,
        entered_at: row.entered_at.toISOString(),
    };
}

export async function listAmplificationCreditEntries(input: {
    cursor: AmplificationCreditCursor | null;
    limit: number;
}): Promise<AmplificationCreditFeedPage> {
    if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > AMPLIFICATION_CREDIT_FEED_MAX_LIMIT
    ) {
        throw new AmplificationCreditFeedError(
            'invalid_limit',
            400,
            `Limit must be an integer between 1 and ${AMPLIFICATION_CREDIT_FEED_MAX_LIMIT}`,
        );
    }
    const cursorPredicate = input.cursor
        ? Prisma.sql`
            WHERE (
                "entered_at" > ${new Date(input.cursor.entered_at)}
                OR ("entered_at" = ${new Date(input.cursor.entered_at)} AND "entry_id" > ${input.cursor.entry_id}::uuid)
            )
        `
        : Prisma.empty;

    const rows = await prisma.$queryRaw<AmplificationCreditDatabaseRow[]>(Prisma.sql`
        WITH "eligible_entries" AS (
            SELECT
                "participant"."id" AS "entry_id",
                "participant"."scheduled_session_id" AS "scheduled_session_id",
                "participant"."ticket_entitlement_id" AS "ticket_entitlement_id",
                "commerce"."registration_id" AS "registration_id",
                "ticket"."bound_email" AS "email",
                "participant"."display_name" AS "display_name",
                MIN("presence"."started_at") AS "entered_at"
            FROM "session_participants" AS "participant"
            INNER JOIN "scheduled_sessions" AS "session"
                ON "session"."id" = "participant"."scheduled_session_id"
            INNER JOIN "ticket_entitlements" AS "ticket"
                ON "ticket"."id" = "participant"."ticket_entitlement_id"
            INNER JOIN "live_presence_intervals" AS "presence"
                ON "presence"."participant_id" = "participant"."id"
                AND "presence"."scheduled_session_id" = "participant"."scheduled_session_id"
            LEFT JOIN "commerce_entitlements" AS "commerce"
                ON "commerce"."ticket_entitlement_id" = "participant"."ticket_entitlement_id"
                AND "commerce"."scheduled_session_id" = "participant"."scheduled_session_id"
            WHERE "session"."is_test" = FALSE
                AND "participant"."staff_user_id" IS NULL
                AND "participant"."ticket_entitlement_id" IS NOT NULL
            GROUP BY
                "participant"."id",
                "participant"."scheduled_session_id",
                "participant"."ticket_entitlement_id",
                "commerce"."registration_id",
                "ticket"."bound_email",
                "participant"."display_name"
        )
        SELECT
            "entry_id",
            "scheduled_session_id",
            "ticket_entitlement_id",
            "registration_id",
            "email",
            "display_name",
            "entered_at"
        FROM "eligible_entries"
        ${cursorPredicate}
        ORDER BY "entered_at" ASC, "entry_id" ASC
        LIMIT ${input.limit}
    `);

    const last = rows.at(-1);
    return {
        schema_version: AMPLIFICATION_CREDIT_FEED_SCHEMA,
        entries: rows.map(mapRow),
        next_cursor: last
            ? encodeAmplificationCreditCursor({
                v: 1,
                entered_at: last.entered_at.toISOString(),
                entry_id: last.entry_id,
            })
            : input.cursor ? encodeAmplificationCreditCursor(input.cursor) : null,
    };
}
