import { createHash } from 'node:crypto';

export const COMMERCE_COMMAND_SCHEMA = 'commerce-entitlement.command.v1' as const;
export const COMMERCE_RESULT_SCHEMA = 'commerce-entitlement.result.v1' as const;
export const COMMERCE_ERROR_SCHEMA = 'commerce-entitlement.error.v1' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXTERNAL_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HUMAN_CODE = /^HB1(?:-[A-HJ-NP-Z2-9]{4}){8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ACTIVE_REASONS = [
    'PAYMENT_VERIFIED',
    'PARTIAL_REFUND_TICKET_VALID',
    'CREDENTIAL_ROTATED',
    'PROVIDER_RECONCILED',
] as const;
export const REVOKED_REASONS = [
    'TICKET_VOIDED',
    'ORDER_CANCELLED',
    'FULL_REFUND',
] as const;

type ActiveReason = typeof ACTIVE_REASONS[number];
type RevokedReason = typeof REVOKED_REASONS[number];
export type CommerceReason = ActiveReason | RevokedReason;

export type CommerceGrant = {
    grant_id: string;
    generation: number;
    derivation_key_version: number;
    code: string;
};

export type CommerceCommand = {
    schema_version: typeof COMMERCE_COMMAND_SCHEMA;
    request_id: string;
    source: 'PMP_MYTH_BOT';
    provider: 'TICKET_TAILOR';
    provision_revision: number;
    desired_provider_state: 'ACTIVE' | 'REVOKED';
    reason_code: CommerceReason;
    external_order_id: string;
    external_ticket_id: string;
    registration_id: string;
    scheduled_session_id: string;
    bound_email: string;
    tier: 'GLOBAL_NORTH' | 'GLOBAL_SOUTH';
    provider_observed_at: string;
    grant: CommerceGrant | null;
};

export type CredentialBinding = {
    grant_id: string;
    generation: number;
    derivation_key_version: number;
} | null;

export type CommerceResult = {
    schema_version: typeof COMMERCE_RESULT_SCHEMA;
    entitlement_id: string;
    outcome: 'APPLIED' | 'REPLAYED' | 'STALE';
    applied_revision: number;
    provider_state: 'ACTIVE' | 'REVOKED';
    administrative_state: 'CLEAR' | 'SUSPENDED';
    effective_state: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';
    credential_action: 'CREATED' | 'ROTATED' | 'UNCHANGED' | 'REVOKED' | 'NONE';
    credential_binding: CredentialBinding;
    web_sessions_revoked_on_apply: number;
    media_disconnection: {
        status: 'NOT_REQUIRED' | 'RECONCILIATION_REQUIRED' | 'DISCONNECTED';
        stage_removed: number;
        bed_removed: number;
    };
    reconciliation_required: boolean;
};

export class CommerceContractError extends Error {
    constructor(
        readonly status: 400 | 404 | 409 | 413 | 422,
        readonly code: string,
        message: string,
        readonly retryable = false,
    ) {
        super(message);
    }
}

function record(value: unknown, field = 'body'): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommerceContractError(400, 'invalid_request', `${field} must be an object`);
    }
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
    const allowedSet = new Set(allowed);
    const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
    if (unknown.length > 0) {
        throw new CommerceContractError(422, 'unknown_field', `${field} contains an unknown field`);
    }
    const missing = allowed.filter((key) => !(key in value));
    if (missing.length > 0) {
        throw new CommerceContractError(422, 'missing_field', `${field} is missing a required field`);
    }
}

function stringField(value: unknown, field: string, maximum = 256): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
        throw new CommerceContractError(422, 'invalid_field', `${field} is invalid`);
    }
    for (let index = 0; index < value.length; index += 1) {
        const unit = value.charCodeAt(index);
        if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
                throw new CommerceContractError(422, 'invalid_unicode', `${field} contains invalid Unicode`);
            }
            index += 1;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            throw new CommerceContractError(422, 'invalid_unicode', `${field} contains invalid Unicode`);
        }
    }
    return value;
}

function positiveInteger(value: unknown, field: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
        throw new CommerceContractError(422, 'invalid_field', `${field} must be a positive integer`);
    }
    return value as number;
}

function uuidField(value: unknown, field: string): string {
    const candidate = stringField(value, field, 36).toLowerCase();
    if (!UUID.test(candidate)) {
        throw new CommerceContractError(422, 'invalid_field', `${field} must be a UUID`);
    }
    return candidate;
}

function externalId(value: unknown, field: string): string {
    const candidate = stringField(value, field, 128);
    if (!EXTERNAL_ID.test(candidate)) {
        throw new CommerceContractError(422, 'invalid_field', `${field} has an invalid format`);
    }
    return candidate;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T {
    if (typeof value !== 'string' || !values.includes(value as T)) {
        throw new CommerceContractError(422, 'invalid_field', `${field} is invalid`);
    }
    return value as T;
}

export function normalizeCommerceEmail(value: unknown): string {
    const email = stringField(value, 'bound_email', 254).trim().toLowerCase();
    if (!EMAIL.test(email)) {
        throw new CommerceContractError(422, 'invalid_field', 'bound_email is invalid');
    }
    return email;
}

export function parseCommerceCommand(input: unknown): CommerceCommand {
    const body = record(input);
    exactKeys(body, [
        'schema_version',
        'request_id',
        'source',
        'provider',
        'provision_revision',
        'desired_provider_state',
        'reason_code',
        'external_order_id',
        'external_ticket_id',
        'registration_id',
        'scheduled_session_id',
        'bound_email',
        'tier',
        'provider_observed_at',
        'grant',
    ], 'body');

    const state = oneOf(body.desired_provider_state, ['ACTIVE', 'REVOKED'] as const, 'desired_provider_state');
    const reason = oneOf(
        body.reason_code,
        state === 'ACTIVE' ? ACTIVE_REASONS : REVOKED_REASONS,
        'reason_code',
    );
    const observedAt = stringField(body.provider_observed_at, 'provider_observed_at', 24);
    if (!CANONICAL_UTC.test(observedAt) || Number.isNaN(Date.parse(observedAt))) {
        throw new CommerceContractError(
            422,
            'invalid_field',
            'provider_observed_at must be canonical UTC with milliseconds',
        );
    }

    let grant: CommerceGrant | null = null;
    if (state === 'ACTIVE') {
        const rawGrant = record(body.grant, 'grant');
        exactKeys(rawGrant, ['grant_id', 'generation', 'derivation_key_version', 'code'], 'grant');
        const code = stringField(rawGrant.code, 'grant.code', 43).toUpperCase();
        if (!HUMAN_CODE.test(code)) {
            throw new CommerceContractError(422, 'invalid_field', 'grant.code has an invalid format');
        }
        grant = {
            grant_id: uuidField(rawGrant.grant_id, 'grant.grant_id'),
            generation: positiveInteger(rawGrant.generation, 'grant.generation'),
            derivation_key_version: positiveInteger(
                rawGrant.derivation_key_version,
                'grant.derivation_key_version',
            ),
            code,
        };
    } else if (body.grant !== null) {
        throw new CommerceContractError(422, 'invalid_field', 'grant must be null for REVOKED');
    }

    return {
        schema_version: oneOf(body.schema_version, [COMMERCE_COMMAND_SCHEMA], 'schema_version'),
        request_id: uuidField(body.request_id, 'request_id'),
        source: oneOf(body.source, ['PMP_MYTH_BOT'], 'source'),
        provider: oneOf(body.provider, ['TICKET_TAILOR'], 'provider'),
        provision_revision: positiveInteger(body.provision_revision, 'provision_revision'),
        desired_provider_state: state,
        reason_code: reason,
        external_order_id: externalId(body.external_order_id, 'external_order_id'),
        external_ticket_id: externalId(body.external_ticket_id, 'external_ticket_id'),
        registration_id: uuidField(body.registration_id, 'registration_id'),
        scheduled_session_id: uuidField(body.scheduled_session_id, 'scheduled_session_id'),
        bound_email: normalizeCommerceEmail(body.bound_email),
        tier: oneOf(body.tier, ['GLOBAL_NORTH', 'GLOBAL_SOUTH'] as const, 'tier'),
        provider_observed_at: observedAt,
        grant,
    };
}

export type CanonicalJson = null | boolean | string | number | CanonicalJson[] | {
    [key: string]: CanonicalJson;
};

/** RFC 8785 for this contract's integer-only JSON domain. */
export function canonicalJson(value: CanonicalJson): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            throw new CommerceContractError(422, 'invalid_field', 'canonical JSON only permits safe integers');
        }
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(',')}}`;
}

export function materialCommerceCommand(command: CommerceCommand): CanonicalJson {
    return {
        schema_version: command.schema_version,
        source: command.source,
        provider: command.provider,
        provision_revision: command.provision_revision,
        desired_provider_state: command.desired_provider_state,
        reason_code: command.reason_code,
        external_order_id: command.external_order_id,
        external_ticket_id: command.external_ticket_id,
        registration_id: command.registration_id,
        scheduled_session_id: command.scheduled_session_id,
        bound_email: command.bound_email,
        tier: command.tier,
        provider_observed_at: command.provider_observed_at,
        grant: command.grant,
    };
}

export function commerceCommandHash(command: CommerceCommand): string {
    return createHash('sha256')
        .update(canonicalJson(materialCommerceCommand(command)), 'utf8')
        .digest('hex');
}
