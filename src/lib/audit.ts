/**
 * Administrative audit log.
 *
 * BUSINESS_RULES.md §1.3 obliges every administrative action to be written here,
 * and TRUST_AND_SAFETY.md §4 makes the log the accountability half of the session
 * kill switch — "the two ship together or the control ships unaccountable".
 *
 * Append-only: this module offers a write and nothing else. There is deliberately
 * no update or delete helper, and no route exposes either. A log an Admin can
 * edit is not evidence of what an Admin did.
 */

import { prisma } from '@/lib/db';
import { redactErrorDetail } from '@/lib/redact';

/**
 * Dotted discriminator for the action taken. A closed union rather than a free
 * string so a typo cannot silently create a category the audit reader filters
 * past without noticing.
 */
export type AuditAction =
    | 'meditation.approve'
    | 'meditation.reject'
    | 'meditation.feature'
    | 'meditation.unfeature'
    | 'meditation.hide'
    | 'meditation.unhide'
    // Roles are granted in Zitadel, so nothing in this app changes one. The
    // refusal is recorded rather than the change: an Admin reaching for a control
    // that should not be reachable is the fact worth having.
    | 'user.role_change_refused'
    | 'tag.create'
    | 'tag.delete'
    | 'report.triage'
    | 'session.terminate';

export type AuditTargetType = 'MEDITATION' | 'USER' | 'TAG' | 'SESSION' | 'REPORT';

/** JSON-safe metadata. Deliberately narrow: audit rows are read by humans. */
export type AuditMetadata = Record<string, string | number | boolean | null>;

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
 * prevent. It is the lesser of the two failures, not a free one. Closing the gap
 * needs a durable queue, which does not exist here yet.
 */
export async function logAdminAction(actor: AuditActor, entry: AuditEntry): Promise<void> {
    try {
        const user = await prisma.user.findUnique({
            where: { zitadelId: actor.user.id },
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
                actorId: user.id,
                actorRole: actor.user.role,
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
