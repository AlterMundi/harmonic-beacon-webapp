import type { EarlyBirdMembershipProjectionCommand } from './membership';
import { isEarlyBirdAccountId } from './account-id';

const COMMAND_KEYS = [
    'account_id', 'current_price', 'effective_at', 'grace_until', 'membership_revision', 'offer',
    'paid_through', 'provider', 'reason_code', 'schema_version', 'source', 'state',
] as const;
const AUTHORITY_KEYS = [
    'access_allowed', 'account_id', 'current_price', 'effective_at', 'free_entitlement_consumed',
    'grace_until', 'membership_revision', 'offer', 'paid_through', 'provider', 'reason_code',
    'schema_version', 'source', 'state',
] as const;
const AUTHORITY_V2_KEYS = [...AUTHORITY_KEYS, 'founder_price_eligibility'] as const;
const STATES = [
    'PENDING', 'ACTIVE', 'GRACE', 'CANCELLED_PENDING_END', 'EXPIRED', 'REFUNDED', 'REVOKED',
] as const;
const SOURCES = ['FREE', 'PAYPAL', 'MERCADO_PAGO'] as const;
const PROVIDERS = ['paypal', 'mercado_pago'] as const;

export class EarlyBirdMembershipContractError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EarlyBirdMembershipContractError';
    }
}

export type CanonicalAuthorityMembership = Omit<EarlyBirdMembershipProjectionCommand, 'schema_version'> & {
    schema_version: 'early-bird-authority.membership.v1';
    access_allowed: boolean;
    free_entitlement_consumed: boolean;
};

export type FounderPriceEligibility = {
    offer: { code: 'EARLY_BIRDS_FOUNDERS_V1'; revision: number };
    canonical_price: { currency: 'USD'; amount_minor: 500 };
    billing_period: 'MONTHLY';
    granted_at: string;
};

export type CanonicalAuthorityMembershipV2 =
    Omit<CanonicalAuthorityMembership, 'schema_version'> & {
        schema_version: 'early-bird-authority.membership.v2';
        founder_price_eligibility: FounderPriceEligibility | null;
    };

function record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new EarlyBirdMembershipContractError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new EarlyBirdMembershipContractError('Membership payload fields do not match the contract');
    }
}

function nullableEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
    if (value === null) return null;
    if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
    throw new EarlyBirdMembershipContractError(`${field} is invalid`);
}

function instant(value: unknown, field: string, nullable = false): string | null {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
        throw new EarlyBirdMembershipContractError(`${field} must be a date-time`);
    }
    return value;
}

export function canonicalRfc3339Instant(value: unknown, field: string): string {
    if (typeof value !== 'string') {
        throw new EarlyBirdMembershipContractError(`${field} must be an RFC 3339 date-time`);
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) {
        throw new EarlyBirdMembershipContractError(`${field} must be an RFC 3339 date-time`);
    }
    const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, , offset] = match;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const second = Number(secondRaw);
    const offsetHour = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
    const offsetMinute = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
    const daysInMonth = month >= 1 && month <= 12
        ? new Date(Date.UTC(year, month, 0)).getUTCDate()
        : 0;
    if (
        day < 1 || day > daysInMonth
        || hour > 23 || minute > 59 || second > 59
        || offsetHour > 23 || offsetMinute > 59
    ) {
        throw new EarlyBirdMembershipContractError(`${field} must be an RFC 3339 date-time`);
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        throw new EarlyBirdMembershipContractError(`${field} must be an RFC 3339 date-time`);
    }
    // PostgreSQL/Prisma stores this projection at millisecond precision. One
    // canonical UTC representation prevents equivalent wire forms from
    // producing different durable evidence hashes.
    return new Date(parsed).toISOString();
}

function canonicalNullableRfc3339Instant(value: unknown, field: string): string | null {
    return value === null ? null : canonicalRfc3339Instant(value, field);
}

function offer(value: unknown): EarlyBirdMembershipProjectionCommand['offer'] {
    if (value === null) return null;
    const input = record(value, 'offer');
    exactKeys(input, ['code', 'revision']);
    if (input.code !== 'EARLY_BIRDS_FOUNDERS_V1' ||
        !Number.isSafeInteger(input.revision) || (input.revision as number) < 1) {
        throw new EarlyBirdMembershipContractError('offer is invalid');
    }
    return { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: input.revision as number };
}

function price(value: unknown): EarlyBirdMembershipProjectionCommand['current_price'] {
    if (value === null) return null;
    const input = record(value, 'current_price');
    exactKeys(input, ['amount_minor', 'currency']);
    if (!['USD', 'ARS'].includes(String(input.currency)) ||
        !Number.isSafeInteger(input.amount_minor) || (input.amount_minor as number) < 1) {
        throw new EarlyBirdMembershipContractError('current_price is invalid');
    }
    return {
        currency: input.currency as 'USD' | 'ARS',
        amount_minor: input.amount_minor as number,
    };
}

function founderPriceEligibility(value: unknown): FounderPriceEligibility | null {
    if (value === null) return null;
    const input = record(value, 'founder_price_eligibility');
    exactKeys(input, ['billing_period', 'canonical_price', 'granted_at', 'offer']);

    const parsedOffer = offer(input.offer);
    if (parsedOffer === null) {
        throw new EarlyBirdMembershipContractError('Founder price eligibility offer is invalid');
    }
    const canonicalPrice = record(input.canonical_price, 'founder canonical_price');
    exactKeys(canonicalPrice, ['amount_minor', 'currency']);
    if (canonicalPrice.currency !== 'USD' || canonicalPrice.amount_minor !== 500) {
        throw new EarlyBirdMembershipContractError('Founder canonical_price is invalid');
    }
    if (input.billing_period !== 'MONTHLY') {
        throw new EarlyBirdMembershipContractError('Founder billing_period is invalid');
    }
    const grantedAt = canonicalRfc3339Instant(input.granted_at, 'Founder granted_at');
    return {
        offer: parsedOffer,
        canonical_price: { currency: 'USD', amount_minor: 500 },
        billing_period: 'MONTHLY',
        granted_at: grantedAt,
    };
}

function common(input: Record<string, unknown>) {
    if (!isEarlyBirdAccountId(input.account_id)) {
        throw new EarlyBirdMembershipContractError('account_id is invalid');
    }
    if (!Number.isSafeInteger(input.membership_revision) || (input.membership_revision as number) < 1) {
        throw new EarlyBirdMembershipContractError('membership_revision is invalid');
    }
    if (!STATES.includes(input.state as typeof STATES[number])) {
        throw new EarlyBirdMembershipContractError('state is invalid');
    }
    if (typeof input.reason_code !== 'string' || input.reason_code.length < 1 || input.reason_code.length > 64) {
        throw new EarlyBirdMembershipContractError('reason_code is invalid');
    }
    return {
        account_id: input.account_id,
        membership_revision: input.membership_revision as number,
        state: input.state as typeof STATES[number],
        source: nullableEnum(input.source, SOURCES, 'source'),
        offer: offer(input.offer),
        effective_at: instant(input.effective_at, 'effective_at')!,
        paid_through: instant(input.paid_through, 'paid_through', true),
        grace_until: instant(input.grace_until, 'grace_until', true),
        provider: nullableEnum(input.provider, PROVIDERS, 'provider'),
        current_price: price(input.current_price),
        reason_code: input.reason_code,
    };
}

function canonicalAccessAllowed(
    membership: Pick<CanonicalAuthorityMembership, 'state' | 'paid_through' | 'grace_until'>,
    now = new Date(),
): boolean {
    if (membership.state === 'ACTIVE') {
        return membership.paid_through === null || new Date(membership.paid_through) > now;
    }
    if (membership.state === 'GRACE') {
        return membership.grace_until !== null && new Date(membership.grace_until) > now;
    }
    if (membership.state === 'CANCELLED_PENDING_END') {
        return membership.paid_through !== null && new Date(membership.paid_through) > now;
    }
    return false;
}

export function parseMembershipProjectionCommand(value: unknown): EarlyBirdMembershipProjectionCommand {
    const input = record(value, 'membership command');
    exactKeys(input, COMMAND_KEYS);
    if (input.schema_version !== 'early-bird-membership.command.v1') {
        throw new EarlyBirdMembershipContractError('Unsupported membership command schema');
    }
    return { schema_version: input.schema_version, ...common(input) };
}

export function parseCanonicalAuthorityMembership(value: unknown): CanonicalAuthorityMembership {
    const input = record(value, 'authority membership');
    exactKeys(input, AUTHORITY_KEYS);
    if (input.schema_version !== 'early-bird-authority.membership.v1') {
        throw new EarlyBirdMembershipContractError('Unsupported authority membership schema');
    }
    if (typeof input.access_allowed !== 'boolean' || typeof input.free_entitlement_consumed !== 'boolean') {
        throw new EarlyBirdMembershipContractError('Authority membership booleans are invalid');
    }
    const membership: CanonicalAuthorityMembership = {
        schema_version: input.schema_version,
        ...common(input),
        access_allowed: input.access_allowed,
        free_entitlement_consumed: input.free_entitlement_consumed,
    };
    if (membership.access_allowed !== canonicalAccessAllowed(membership)) {
        throw new EarlyBirdMembershipContractError(
            'Authority access decision contradicts membership state or time bounds',
        );
    }
    return membership;
}

export function parseCanonicalAuthorityMembershipV2(value: unknown): CanonicalAuthorityMembershipV2 {
    const input = record(value, 'authority membership v2');
    exactKeys(input, AUTHORITY_V2_KEYS);
    if (input.schema_version !== 'early-bird-authority.membership.v2') {
        throw new EarlyBirdMembershipContractError('Unsupported authority membership schema');
    }
    if (typeof input.access_allowed !== 'boolean' || typeof input.free_entitlement_consumed !== 'boolean') {
        throw new EarlyBirdMembershipContractError('Authority membership booleans are invalid');
    }
    const eligibility = founderPriceEligibility(input.founder_price_eligibility);
    const shared = common(input);
    const membership: CanonicalAuthorityMembershipV2 = {
        schema_version: input.schema_version,
        ...shared,
        effective_at: canonicalRfc3339Instant(input.effective_at, 'effective_at'),
        paid_through: canonicalNullableRfc3339Instant(input.paid_through, 'paid_through'),
        grace_until: canonicalNullableRfc3339Instant(input.grace_until, 'grace_until'),
        access_allowed: input.access_allowed,
        free_entitlement_consumed: input.free_entitlement_consumed,
        founder_price_eligibility: eligibility,
    };
    if (membership.access_allowed !== canonicalAccessAllowed(membership)) {
        throw new EarlyBirdMembershipContractError(
            'Authority access decision contradicts membership state or time bounds',
        );
    }
    if (
        membership.access_allowed
        && (membership.source === 'PAYPAL' || membership.source === 'MERCADO_PAGO')
        && eligibility === null
    ) {
        throw new EarlyBirdMembershipContractError(
            'Paid access is missing canonical Founder price eligibility',
        );
    }
    return membership;
}

export function authorityMembershipCommand(
    membership: CanonicalAuthorityMembership,
): EarlyBirdMembershipProjectionCommand {
    return {
        schema_version: 'early-bird-membership.command.v1',
        account_id: membership.account_id,
        membership_revision: membership.membership_revision,
        state: membership.state,
        source: membership.source,
        offer: membership.offer,
        effective_at: membership.effective_at,
        paid_through: membership.paid_through,
        grace_until: membership.grace_until,
        provider: membership.provider,
        current_price: membership.current_price,
        reason_code: membership.reason_code,
    };
}
