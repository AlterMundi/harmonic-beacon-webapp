/**
 * Audit log.
 *
 * Two audiences share this module:
 *
 *   1. The weekend admission surface (`recordAuditEvent`), reduced to what
 *      the fresh schema (`AuditLog` in prisma/schema.prisma) supports: actor,
 *      action, target, time, and non-PII reason metadata. Every admission
 *      mutation — batch generation/import, revocation, rebind, comp/override
 *      issuance — writes one row here.
 *   2. The pre-weekend moderation routes (`logAdminAction` and its types),
 *      kept so those strip-owned callers keep working until Ani's strip
 *      removes them. They reference pre-weekend schema fields and are not
 *      part of the weekend contract.
 *
 * Append-only: this module offers writes and nothing else. There is
 * deliberately no update or delete helper, and no route exposes either. A log
 * an Admin can edit is not evidence of what an Admin did.
 *
 * PII discipline: `reason` and `metadata` must never contain ticket codes,
 * session tokens, or attendee emails. The admission routes enforce this by
 * never threading attendee identifiers into these fields.
 */

import { prisma } from '@/lib/db';
import { redactErrorDetail } from '@/lib/redact';

/** JSON-safe metadata. Deliberately narrow: audit rows are read by humans. */
export type AuditMetadata = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------------------
// Weekend admission audit (WS1-03)
// ---------------------------------------------------------------------------

/**
 * Dotted discriminator for the action taken. A closed union rather than a
 * free string so a typo cannot silently create a category the audit reader
 * filters past without noticing.
 */
export type AdmissionAuditAction =
    | 'ticket.batch_generate'
    | 'ticket.batch_import'
    | 'ticket.comp_issue'
    | 'ticket.revoke'
    | 'ticket.rebind';

export type AdmissionAuditTargetType = 'TICKET_ENTITLEMENT' | 'SCHEDULED_SESSION';

export interface AdmissionAuditEvent {
    /** Staff user id, or null for CLI actions that name their source in metadata. */
    actorUserId: string | null;
    action: AdmissionAuditAction;
    targetType: AdmissionAuditTargetType;
    targetId: string;
    /** Non-PII reason text; required by the routes that mandate one. */
    reason?: string;
    metadata?: AuditMetadata;
}

/**
 * Write one audit entry. Never throws.
 *
 * A failed audit write must not fail the action it describes. An operator
 * revoking a ticket in response to a live support call cannot be told "revoke
 * failed" because a log insert timed out — the admission risk continues while
 * the logging does not. So this swallows every error and reports it to
 * stderr, and every caller can `await` it without a try/catch.
 *
 * The cost of that choice is real and worth naming: a dropped write leaves a
 * mutation with no trace, which is precisely what the log exists to prevent.
 * It is the lesser of the two failures, not a free one.
 */
export async function recordAuditEvent(event: AdmissionAuditEvent): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                actorUserId: event.actorUserId,
                action: event.action,
                targetType: event.targetType,
                targetId: event.targetId,
                ...(event.reason !== undefined ? { reason: event.reason } : {}),
                ...(event.metadata ? { metadata: event.metadata } : {}),
            },
        });
    } catch (error) {
        console.error(`[audit] failed to write entry for ${event.action}:`, redactErrorDetail(error));
    }
}

// ---------------------------------------------------------------------------
// Pre-weekend moderation audit — strip-owned legacy, kept for its callers
// until the strip removes them. Not part of the weekend contract.
// ---------------------------------------------------------------------------

export type AuditAction =
    | 'meditation.approve'
    | 'meditation.reject'
    | 'meditation.feature'
    | 'meditation.unfeature'
    | 'meditation.hide'
    | 'meditation.unhide'
    // Provider-initiated, not administrative: the Provider removing their own
    // content under CONTENT_POLICY.md §6.1. It lands in the same log because the
    // log is the record of anything that changes what a Listener can reach, and
    // it stays separate from `meditation.hide` even though both write the same
    // flag — the author withdrawing their work and a moderator removing it are
    // different acts, and a log that conflates them cannot answer "did we pull
    // this, or did they?". `actorRole` reads PROVIDER rather than ADMIN for
    // these.
    | 'meditation.takedown'
    // Reversing an author's withdrawal, not the platform's own hide. Distinct so
    // that "who put this back" is answerable without reading flags.
    | 'meditation.restore_takedown'
    // Roles are granted in Zitadel, so nothing in this app changes one. The
    // refusal is recorded rather than the change: an Admin reaching for a control
    // that should not be reachable is the fact worth having.
    | 'user.role_change_refused'
    | 'tag.create'
    | 'tag.delete'
    | 'report.triage'
    | 'session.terminate';

export type AuditTargetType = 'MEDITATION' | 'USER' | 'TAG' | 'SESSION' | 'REPORT';

export interface AuditActor {
    /**
     * The acting session. `user.id` is the Zitadel subject, not the DB uuid —
     * resolved here so every call site does not repeat the lookup, and `user.role`
     * is snapshotted as the actor's role at the time of the action.
     */
    user: { id: string; role: string };
}

export interface AuditEntry {
    action: AuditAction;
    targetType: AuditTargetType;
    targetId: string;
    metadata?: AuditMetadata;
}

/**
 * Write one audit entry. Never throws.
 *
 * A failed audit write must not fail the action it describes. An Admin hiding
 * content in response to a live safety report cannot be told "hide failed"
 * because a log insert timed out — the harm continues while the moderation does
 * not. So this swallows every error and reports it to stderr, and every caller
 * can `await` it without a try/catch.
 *
 * The cost of that choice is real and worth naming: a dropped write leaves a
 * moderation action with no trace, which is precisely what the log exists to
 * prevent. It is the lesser of the two failures, not a free one. Closing the
 * gap needs a durable queue, which does not exist here yet.
 */
export async function logAdminAction(actor: AuditActor, entry: AuditEntry): Promise<void> {
    try {
        const user = await prisma.user.findUnique({
            where: { id: actor.user.id },
            select: { id: true },
        });

        if (!user) {
            // Should not happen: every admin route resolves a session before
            // acting. Log rather than throw, for the reason above.
            console.error(`[audit] no user row for acting subject; dropped action ${entry.action}`);
            return;
        }

        await prisma.auditLog.create({
            data: {
                actorUserId: user.id,
                action: entry.action,
                targetType: entry.targetType,
                targetId: entry.targetId,
                ...(entry.metadata ? { metadata: entry.metadata } : {}),
            },
        });
    } catch (error) {
        console.error(`[audit] failed to write entry for ${entry.action}:`, redactErrorDetail(error));
    }
}
