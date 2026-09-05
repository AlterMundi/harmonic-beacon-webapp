import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { ticketExpiresAt } from '@/lib/admission';
import {
    CommerceCommand,
    CommerceContractError,
    CommerceResult,
    commerceCommandHash,
} from '@/lib/commerce-contract';
import { prisma } from '@/lib/db';
import { bedRoomIdentity } from '@/lib/livekit-server';
import { ticketCodeStorage } from '@/lib/ticket-code';
import { transitionParticipantGrant } from '@/lib/stage-grant-effects';

type CommerceRow = Prisma.CommerceEntitlementGetPayload<{
    include: {
        ticketEntitlement: true;
        mediaJobs: { orderBy: { createdAt: 'desc' }; take: 1 };
    };
}>;

type AppliedEffect = {
    credential_action: CommerceResult['credential_action'];
    web_sessions_revoked_on_apply: number;
};

function effectiveState(row: CommerceRow, now: Date): CommerceResult['effective_state'] {
    if (row.providerState === 'REVOKED') return 'REVOKED';
    if (row.administrativeState === 'SUSPENDED') return 'SUSPENDED';
    if (row.ticketEntitlement.expiresAt <= now) return 'EXPIRED';
    return 'ACTIVE';
}

function binding(row: CommerceRow): CommerceResult['credential_binding'] {
    if (!row.grantId || row.grantGeneration === null || row.derivationKeyVersion === null) {
        return null;
    }
    return {
        grant_id: row.grantId,
        generation: row.grantGeneration,
        derivation_key_version: row.derivationKeyVersion,
    };
}

function resultFor(
    row: CommerceRow,
    outcome: CommerceResult['outcome'],
    effect: AppliedEffect,
    now: Date,
): CommerceResult {
    // A superseded job may keep removing an old, versioned identity through
    // its token horizon, but it is not the reconciliation state of the latest
    // provider revision and must not leak stale counters into its snapshot.
    const latestJob = row.mediaJobs[0];
    const job = latestJob?.provisionRevision === row.provisionRevision
        ? latestJob
        : undefined;
    return {
        schema_version: 'commerce-entitlement.result.v1',
        entitlement_id: row.id,
        outcome,
        applied_revision: row.provisionRevision,
        provider_state: row.providerState,
        administrative_state: row.administrativeState,
        effective_state: effectiveState(row, now),
        credential_action: effect.credential_action,
        credential_binding: binding(row),
        web_sessions_revoked_on_apply: effect.web_sessions_revoked_on_apply,
        media_disconnection: {
            status: row.mediaStatus,
            stage_removed: job?.stageRemoved ?? 0,
            bed_removed: job?.bedRemoved ?? 0,
        },
        reconciliation_required: row.mediaStatus === 'RECONCILIATION_REQUIRED',
    };
}

function appliedEffect(value: Prisma.JsonValue | null | undefined): AppliedEffect {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { credential_action: 'UNCHANGED', web_sessions_revoked_on_apply: 0 };
    }
    const raw = value as Record<string, Prisma.JsonValue>;
    const action = raw.credential_action;
    const count = raw.web_sessions_revoked_on_apply;
    const allowed: CommerceResult['credential_action'][] = [
        'CREATED', 'ROTATED', 'UNCHANGED', 'REVOKED', 'NONE',
    ];
    return {
        credential_action: typeof action === 'string' && allowed.includes(
            action as CommerceResult['credential_action'],
        ) ? action as CommerceResult['credential_action'] : 'UNCHANGED',
        web_sessions_revoked_on_apply: typeof count === 'number' ? count : 0,
    };
}

function immutableChanged(row: CommerceRow, command: CommerceCommand): boolean {
    return row.externalOrderId !== command.external_order_id ||
        row.registrationId !== command.registration_id ||
        row.scheduledSessionId !== command.scheduled_session_id ||
        row.provider !== command.provider ||
        (row.bindingGrantId !== null && command.grant !== null &&
            row.bindingGrantId !== command.grant.grant_id);
}

function revokedPlaceholder(externalTicketId: string): { codeDigest: string; codeLastFour: string } {
    const suffix = createHash('sha256').update(externalTicketId, 'utf8').digest('hex').slice(0, 32);
    return ticketCodeStorage(`HB1-REVOKED-${suffix}`);
}

async function lockedSession(
    tx: Prisma.TransactionClient,
    sessionId: string,
) {
    await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "scheduled_sessions" WHERE "id"::text = ${sessionId} FOR UPDATE`,
    );
    return tx.scheduledSession.findUnique({ where: { id: sessionId } });
}

async function loadRow(tx: Prisma.TransactionClient, id: string): Promise<CommerceRow> {
    const row = await tx.commerceEntitlement.findUnique({
        where: { id },
        include: { ticketEntitlement: true, mediaJobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!row) throw new CommerceContractError(404, 'not_found', 'Entitlement not found');
    return row;
}

async function applyInTransaction(
    tx: Prisma.TransactionClient,
    command: CommerceCommand,
    hash: string,
    now: Date,
): Promise<CommerceResult> {
    await tx.$queryRaw(
        Prisma.sql`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`${command.provider}:${command.external_ticket_id}`}, 0))`,
    );

    const reusedRequest = await tx.commerceRequestReceipt.findUnique({
        where: { source_requestId: { source: command.source, requestId: command.request_id } },
        include: { commerceEntitlement: true },
    });
    if (reusedRequest && (
        reusedRequest.commerceEntitlement.externalTicketId !== command.external_ticket_id ||
        reusedRequest.provisionRevision !== command.provision_revision ||
        reusedRequest.commandHash !== hash
    )) {
        throw new CommerceContractError(409, 'request_id_reused', 'request_id was used by another command');
    }

    let current = await tx.commerceEntitlement.findUnique({
        where: {
            provider_externalTicketId: {
                provider: command.provider,
                externalTicketId: command.external_ticket_id,
            },
        },
        include: { ticketEntitlement: true, mediaJobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (current && command.provision_revision < current.provisionRevision) {
        const effect = { credential_action: 'UNCHANGED', web_sessions_revoked_on_apply: 0 } as const;
        if (!reusedRequest) {
            await tx.commerceRequestReceipt.create({
                data: {
                    commerceEntitlementId: current.id,
                    source: command.source,
                    requestId: command.request_id,
                    provisionRevision: command.provision_revision,
                    commandHash: hash,
                },
            });
        }
        return resultFor(current, 'STALE', effect, now);
    }

    if (current && command.provision_revision === current.provisionRevision) {
        if (current.commandHash !== hash) {
            throw new CommerceContractError(409, 'revision_conflict', 'Revision has different material');
        }
        if (!reusedRequest) {
            await tx.commerceRequestReceipt.create({
                data: {
                    commerceEntitlementId: current.id,
                    source: command.source,
                    requestId: command.request_id,
                    provisionRevision: command.provision_revision,
                    commandHash: hash,
                },
            });
        }
        const applied = await tx.commerceEntitlementCommand.findUnique({
            where: {
                commerceEntitlementId_provisionRevision: {
                    commerceEntitlementId: current.id,
                    provisionRevision: command.provision_revision,
                },
            },
        });
        return resultFor(current, 'REPLAYED', appliedEffect(applied?.appliedSnapshot), now);
    }

    if (current && immutableChanged(current, command)) {
        throw new CommerceContractError(409, 'immutable_binding', 'Immutable commerce binding changed');
    }
    if (current?.highestGrantGeneration && command.grant &&
        command.grant.generation < current.highestGrantGeneration) {
        throw new CommerceContractError(409, 'generation_regressed', 'Credential generation cannot decrease');
    }
    if (current?.highestGrantGeneration && command.grant &&
        command.grant.generation === current.highestGrantGeneration &&
        (command.bound_email !== current.boundEmail ||
            command.grant.grant_id !== current.bindingGrantId ||
            command.grant.derivation_key_version !== current.bindingDerivationKeyVersion ||
            ticketCodeStorage(command.grant.code).codeDigest !== current.bindingCodeDigest)) {
        throw new CommerceContractError(409, 'generation_conflict', 'Credential generation changed material');
    }

    const session = await lockedSession(tx, command.scheduled_session_id);
    if (!session) throw new CommerceContractError(404, 'session_not_found', 'Session not found');
    if (current) {
        await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "ticket_entitlements" WHERE "id"::text = ${current.ticketEntitlementId} FOR UPDATE`,
        );
        // Administrative suspend/resume uses the ticket row as the shared
        // mutex. Re-read after acquiring it so provider updates can never
        // overwrite a concurrent safety hold with a stale CLEAR snapshot.
        current = await loadRow(tx, current.id);
    }
    if (command.desired_provider_state === 'ACTIVE' &&
        (session.isTest || !session.paidMode || !['SCHEDULED', 'LIVE'].includes(session.status))) {
        throw new CommerceContractError(409, 'session_unavailable', 'Session cannot accept commerce access');
    }

    const needsSeat = command.desired_provider_state === 'ACTIVE' &&
        (!current || current.providerState === 'REVOKED');
    if (needsSeat) {
        const occupied = await tx.ticketEntitlement.count({
            where: {
                scheduledSessionId: session.id,
                OR: [
                    // A safety hold blocks access but does not cancel a paid
                    // provider grant, so it must continue occupying its seat.
                    { commerceEntitlement: { is: { providerState: 'ACTIVE' } } },
                    {
                        commerceEntitlement: { is: null },
                        state: { not: 'REVOKED' },
                    },
                ],
            },
        });
        if (occupied >= session.attendeeCap) {
            throw new CommerceContractError(409, 'capacity_exceeded', 'Session attendee capacity is full');
        }
    }

    const codeStorage = command.grant
        ? ticketCodeStorage(command.grant.code)
        : revokedPlaceholder(command.external_ticket_id);
    const providerActive = command.desired_provider_state === 'ACTIVE';
    const restoresProviderAccess = Boolean(
        current && providerActive && current.providerState === 'REVOKED',
    );
    const effectiveActive = providerActive && (current?.administrativeState ?? 'CLEAR') === 'CLEAR';
    const expiresAt = ticketExpiresAt(session.scheduledAt, now);

    const ticket = current
        ? await tx.ticketEntitlement.update({
            where: { id: current.ticketEntitlementId },
            data: {
                ...codeStorage,
                tier: command.tier,
                boundEmail: command.bound_email,
                boundAt: current.ticketEntitlement.boundAt ?? now,
                expiresAt,
                state: effectiveActive ? 'BOUND' : 'REVOKED',
                revokedAt: effectiveActive ? null : now,
                revocationReason: effectiveActive ? null : command.reason_code,
            },
        })
        : await tx.ticketEntitlement.create({
            data: {
                scheduledSessionId: session.id,
                ...codeStorage,
                tier: command.tier,
                boundEmail: command.bound_email,
                boundAt: now,
                expiresAt,
                state: effectiveActive ? 'BOUND' : 'REVOKED',
                revokedAt: effectiveActive ? null : now,
                revocationReason: effectiveActive ? null : command.reason_code,
            },
        });

    const rotation = Boolean(current && command.grant && current.highestGrantGeneration !== null &&
        command.grant.generation > current.highestGrantGeneration);
    const disconnectRequired = Boolean(current && (rotation || command.desired_provider_state === 'REVOKED'));
    let revokedSessions = 0;
    if (disconnectRequired) {
        revokedSessions = (await tx.webSession.updateMany({
            where: { ticketEntitlementId: ticket.id, revokedAt: null },
            data: { revokedAt: now, revocationReason: `Commerce ${command.reason_code}` },
        })).count;
    }

    const participant = disconnectRequired
        ? await tx.sessionParticipant.findFirst({
            where: { scheduledSessionId: session.id, ticketEntitlementId: ticket.id },
        })
        : null;
    const tokenHorizon = current?.maxLivekitTokenExpiresAt && current.maxLivekitTokenExpiresAt > now
        ? current.maxLivekitTokenExpiresAt
        : now;
    if (participant) {
        await transitionParticipantGrant(tx, {
            scheduledSessionId: session.id,
            participantId: participant.id,
            canPublish: false,
            now,
            actorUserId: null,
            reason: `Commerce ${command.reason_code}`,
            clearHand: true,
            markLeft: true,
            disconnectParticipant: true,
            tokenHorizonAt: tokenHorizon,
        });
    }

    const action: CommerceResult['credential_action'] = !providerActive
        ? (current?.grantId ? 'REVOKED' : 'NONE')
        : !current
            ? 'CREATED'
            : rotation
                ? 'ROTATED'
                : 'UNCHANGED';
    const effect: AppliedEffect = {
        credential_action: action,
        web_sessions_revoked_on_apply: revokedSessions,
    };
    const mediaStatus = participant ? 'RECONCILIATION_REQUIRED' : 'NOT_REQUIRED';
    const data = {
        provider: command.provider,
        externalTicketId: command.external_ticket_id,
        externalOrderId: command.external_order_id,
        registrationId: command.registration_id,
        scheduledSessionId: session.id,
        ticketEntitlementId: ticket.id,
        providerState: command.desired_provider_state,
        reasonCode: command.reason_code,
        provisionRevision: command.provision_revision,
        commandHash: hash,
        boundEmail: command.bound_email,
        tier: command.tier,
        bindingGrantId: current?.bindingGrantId ?? command.grant?.grant_id ?? null,
        highestGrantGeneration: command.grant?.generation ?? current?.highestGrantGeneration ?? null,
        bindingDerivationKeyVersion: command.grant?.derivation_key_version ??
            current?.bindingDerivationKeyVersion ?? null,
        bindingCodeDigest: command.grant ? codeStorage.codeDigest : current?.bindingCodeDigest ?? null,
        grantId: command.grant?.grant_id ?? null,
        grantGeneration: command.grant?.generation ?? null,
        derivationKeyVersion: command.grant?.derivation_key_version ?? null,
        codeDigestVersion: command.grant ? Number(process.env.TICKET_CODE_DIGEST_VERSION || '1') : null,
        providerObservedAt: new Date(command.provider_observed_at),
        mediaStatus,
        // Outbox jobs retain the exact previous identity. Rotations and
        // reactivations issue a different identity, so reconciliation through
        // the old-token horizon can never kick newly authorized media.
        livekitIdentityVersion: current
            ? current.livekitIdentityVersion + (rotation || restoresProviderAccess ? 1 : 0)
            : 1,
    } as const;
    const saved = current
        ? await tx.commerceEntitlement.update({ where: { id: current.id }, data })
        : await tx.commerceEntitlement.create({ data });

    await tx.commerceEntitlementCommand.create({
        data: {
            commerceEntitlementId: saved.id,
            source: command.source,
            requestId: command.request_id,
            provisionRevision: command.provision_revision,
            commandHash: hash,
            appliedSnapshot: effect,
            webSessionsRevoked: revokedSessions,
        },
    });
    await tx.commerceRequestReceipt.create({
        data: {
            commerceEntitlementId: saved.id,
            source: command.source,
            requestId: command.request_id,
            provisionRevision: command.provision_revision,
            commandHash: hash,
        },
    });
    await tx.auditLog.create({
        data: {
            action: 'commerce.entitlement_apply',
            targetType: 'COMMERCE_ENTITLEMENT',
            targetId: saved.id,
            reason: command.reason_code,
            metadata: {
                source: command.source,
                provider: command.provider,
                revision: command.provision_revision,
                providerState: command.desired_provider_state,
                credentialAction: action,
                webSessionsRevoked: revokedSessions,
                mediaReconciliationRequired: participant !== null,
            },
        },
    });

    if (participant) {
        await tx.commerceMediaOutbox.create({
            data: {
                commerceEntitlementId: saved.id,
                provisionRevision: command.provision_revision,
                stageRoomName: session.roomName,
                participantIdentity: participant.participantIdentity,
                bedIdentity: bedRoomIdentity(participant.participantIdentity),
                tokenHorizonAt: tokenHorizon,
                nextAttemptAt: now,
            },
        });
    }

    const complete = await loadRow(tx, saved.id);
    return resultFor(complete, 'APPLIED', effect, now);
}

export async function applyCommerceCommand(
    command: CommerceCommand,
    pathExternalTicketId: string,
    now = new Date(),
): Promise<CommerceResult> {
    if (pathExternalTicketId !== command.external_ticket_id) {
        throw new CommerceContractError(422, 'path_mismatch', 'Path ticket does not match body');
    }
    const hash = commerceCommandHash(command);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await prisma.$transaction(
                (tx) => applyInTransaction(tx, command, hash, now),
                { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            );
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) {
                continue;
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new CommerceContractError(409, 'credential_conflict', 'Credential is already bound');
            }
            throw error;
        }
    }
    throw new Error('unreachable');
}

export async function getCommerceEntitlement(
    externalTicketId: string,
    now = new Date(),
): Promise<CommerceResult | null> {
    const row = await prisma.commerceEntitlement.findUnique({
        where: {
            provider_externalTicketId: {
                provider: 'TICKET_TAILOR',
                externalTicketId,
            },
        },
        include: { ticketEntitlement: true, mediaJobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!row) return null;
    return resultFor(row, 'REPLAYED', { credential_action: binding(row) ? 'UNCHANGED' : 'NONE', web_sessions_revoked_on_apply: 0 }, now);
}

export const TICKET_LIVEKIT_TOKEN_TTL_SECONDS = 5 * 60;
