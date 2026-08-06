import { createHash } from 'node:crypto';

import { isEarlyBirdAccountId } from './account-id';
import {
    authorityMembershipCommand,
    parseCanonicalAuthorityMembership,
} from './membership-contract';
import {
    applyMembershipProjection,
    type EarlyBirdMembershipProjectionCommand,
} from './membership';

const INVITATION_TOKEN = /^ebi_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const REQUEST_TIMEOUT_MS = 5_000;

export type CanonicalFreeRedemptionResult =
    | {
        ok: true;
        replayed: boolean;
        alreadyEntitled: boolean;
        projection: EarlyBirdMembershipProjectionCommand;
    }
    | { ok: false; reason: 'unavailable' };

export interface EarlyBirdMembershipGateway {
    redeemFree(input: {
        accountId: string;
        opaqueInvitation: string;
    }): Promise<CanonicalFreeRedemptionResult>;
}

export class EarlyBirdMembershipGatewayUnavailableError extends Error {
    constructor() {
        super('Canonical EarlyBird membership gateway is unavailable');
        this.name = 'EarlyBirdMembershipGatewayUnavailableError';
    }
}

type GatewayConfig = { baseUrl: string; keyId: string; token: string };

function gatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
    const baseUrl = env.EARLY_BIRDS_AUTHORITY_BASE_URL?.trim();
    const keyId = env.EARLY_BIRDS_AUTHORITY_SERVICE_KEY_ID?.trim();
    const token = env.EARLY_BIRDS_AUTHORITY_SERVICE_TOKEN?.trim();
    if (!baseUrl || !keyId || !token || token.length < 43) {
        throw new EarlyBirdMembershipGatewayUnavailableError();
    }
    let parsed: URL;
    try {
        parsed = new URL(baseUrl);
    } catch {
        throw new EarlyBirdMembershipGatewayUnavailableError();
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new EarlyBirdMembershipGatewayUnavailableError();
    }
    return { baseUrl: parsed.toString().replace(/\/$/, ''), keyId, token };
}

function redemptionIdempotencyKey(accountId: string, invitation: string): string {
    const digest = createHash('sha256').update(`${accountId}\n${invitation}`).digest('hex');
    return `early-bird-invitation-redeem:${digest}`;
}

export class HttpEarlyBirdMembershipGateway implements EarlyBirdMembershipGateway {
    constructor(
        private readonly config: GatewayConfig = gatewayConfig(),
        private readonly request: typeof fetch = fetch,
    ) {}

    async redeemFree({ accountId, opaqueInvitation }: {
        accountId: string;
        opaqueInvitation: string;
    }): Promise<CanonicalFreeRedemptionResult> {
        if (!isEarlyBirdAccountId(accountId)) throw new EarlyBirdMembershipGatewayUnavailableError();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await this.request(
                `${this.config.baseUrl}/api/internal/v1/early-bird-invitations/redeem`,
                {
                    method: 'POST',
                    redirect: 'error',
                    cache: 'no-store',
                    signal: controller.signal,
                    headers: {
                        accept: 'application/json',
                        authorization: `Bearer ${this.config.token}`,
                        'content-type': 'application/json',
                        'idempotency-key': redemptionIdempotencyKey(accountId, opaqueInvitation),
                        'x-hb-service-key-id': this.config.keyId,
                    },
                    body: JSON.stringify({
                        schema_version: 'early-bird-authority.invitation-redeem.v1',
                        account_id: accountId,
                        invitation_token: opaqueInvitation,
                    }),
                },
            );
            if (!response.ok) {
                if (response.status === 409) return { ok: false, reason: 'unavailable' };
                throw new EarlyBirdMembershipGatewayUnavailableError();
            }
            const membership = parseCanonicalAuthorityMembership(await response.json());
            if (membership.account_id !== accountId) throw new EarlyBirdMembershipGatewayUnavailableError();
            const projection = authorityMembershipCommand(membership);
            return {
                ok: true,
                replayed: false,
                alreadyEntitled: membership.access_allowed && membership.reason_code !== 'INVITATION_REDEEMED',
                projection,
            };
        } catch (error) {
            if (error instanceof EarlyBirdMembershipGatewayUnavailableError) throw error;
            throw new EarlyBirdMembershipGatewayUnavailableError();
        } finally {
            clearTimeout(timeout);
        }
    }
}

let gatewayOverride: EarlyBirdMembershipGateway | null = null;

export function setEarlyBirdMembershipGatewayForTests(gateway: EarlyBirdMembershipGateway | null): void {
    gatewayOverride = gateway;
}

export function earlyBirdMembershipGateway(): EarlyBirdMembershipGateway {
    return gatewayOverride ?? new HttpEarlyBirdMembershipGateway();
}

/** The browser's opaque invitation is consumed only by the canonical authority. */
export async function redeemFreeThroughCanonicalGateway(
    accountId: string,
    opaqueInvitation: string,
    gateway = earlyBirdMembershipGateway(),
): Promise<CanonicalFreeRedemptionResult> {
    if (!isEarlyBirdAccountId(accountId) || opaqueInvitation.length < 32 ||
        opaqueInvitation.length > 512 || !INVITATION_TOKEN.test(opaqueInvitation)) {
        return { ok: false, reason: 'unavailable' };
    }
    const result = await gateway.redeemFree({ accountId, opaqueInvitation });
    if (!result.ok) return result;
    if (result.projection.account_id !== accountId) throw new EarlyBirdMembershipGatewayUnavailableError();
    const applied = await applyMembershipProjection(result.projection);
    return {
        ...result,
        replayed: applied.outcome === 'REPLAYED',
        alreadyEntitled: result.alreadyEntitled || applied.outcome === 'STALE',
    };
}
