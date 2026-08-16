import { createHash } from 'node:crypto';

import { isEarlyBirdAccountId } from './account-id';
import {
    listenerAuthorityConfig,
    listenerBoundedJson,
    type ListenerCheckoutEnvironment,
    type ListenerCheckoutProvider,
} from './checkout';

const REQUEST_TIMEOUT_MS = 10_000;

export type ListenerMembershipAction = 'cancel' | 'reactivate';

export class ListenerMembershipActionUnavailableError extends Error {
    constructor() {
        super('Listener membership action is unavailable');
        this.name = 'ListenerMembershipActionUnavailableError';
    }
}

function idempotencyKey(
    accountId: string,
    attemptId: string,
    action: ListenerMembershipAction,
    environment: ListenerCheckoutEnvironment,
    provider: ListenerCheckoutProvider | null,
): string {
    const digest = createHash('sha256')
        .update(`listener-membership-action-v1\n${action}\n${environment}\n${provider ?? 'canonical'}\n${accountId}\n${attemptId}`)
        .digest('hex');
    return `listener-membership:${digest}`;
}

export class HttpListenerMembershipActionsGateway {
    constructor(
        private readonly config = listenerAuthorityConfig(),
        private readonly request: typeof fetch = fetch,
    ) {}

    async requestAction(input: {
        accountId: string;
        attemptId: string;
        action: ListenerMembershipAction;
        environment?: ListenerCheckoutEnvironment;
        provider?: ListenerCheckoutProvider | null;
    }): Promise<void> {
        if (!isEarlyBirdAccountId(input.accountId) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.attemptId)) {
            throw new ListenerMembershipActionUnavailableError();
        }
        const environment = input.environment ?? 'live';
        const provider = input.provider ?? null;
        if (environment === 'staging' && provider === null) {
            throw new ListenerMembershipActionUnavailableError();
        }
        const endpoint = environment === 'live'
            ? '/api/internal/v1/listener-membership-actions'
            : provider === 'paypal'
                ? '/api/internal/v1/early-bird-paypal-actions'
                : '/api/internal/v1/early-bird-mercado-pago-actions';
        const providerAction = provider === 'paypal'
            ? input.action === 'cancel' ? 'suspend' : 'activate'
            : input.action === 'cancel' ? 'pause' : 'reactivate';
        const payload = environment === 'live' ? {
            schema_version: 'listener-membership.action.v1',
            account_id: input.accountId,
            action: input.action,
        } : provider === 'paypal' ? {
            schema_version: 'early-bird-paypal-lifecycle.command.v1',
            account_id: input.accountId,
            action: providerAction,
        } : {
            schema_version: 'early-bird-mercado-pago-lifecycle.command.v1',
            account_id: input.accountId,
            action: providerAction,
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await this.request(
                `${this.config.baseUrl}${endpoint}`,
                {
                    method: 'POST',
                    redirect: 'error',
                    cache: 'no-store',
                    signal: controller.signal,
                    headers: {
                        accept: 'application/json',
                        authorization: `Bearer ${this.config.token}`,
                        'content-type': 'application/json',
                        'idempotency-key': idempotencyKey(
                            input.accountId,
                            input.attemptId,
                            input.action,
                            environment,
                            provider,
                        ),
                        'x-hb-service-key-id': this.config.keyId,
                    },
                    body: JSON.stringify(payload),
                },
            );
            if (response.status !== 202 ||
                response.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
                await response.body?.cancel().catch(() => undefined);
                throw new ListenerMembershipActionUnavailableError();
            }
            const raw = await listenerBoundedJson(response);
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                throw new ListenerMembershipActionUnavailableError();
            }
            const body = raw as Record<string, unknown>;
            const liveExpected = ['account_id', 'action', 'job_id', 'provider', 'schema_version', 'status'];
            const stagingExpected = [
                'account_id', 'action', 'external_subscription_id', 'job_id', 'schema_version', 'status',
            ];
            const schema = provider === 'paypal'
                ? 'early-bird-paypal-lifecycle.response.v1'
                : 'early-bird-mercado-pago-lifecycle.response.v1';
            const expectedResponseAction = environment === 'live' ? input.action : providerAction;
            const commonInvalid = body.account_id !== input.accountId || body.action !== expectedResponseAction ||
                body.status !== 'queued' || typeof body.job_id !== 'string' || !body.job_id;
            const liveInvalid = environment === 'live' && (
                Object.keys(body).sort().join('\0') !== liveExpected.sort().join('\0') ||
                body.schema_version !== 'listener-membership.action-result.v1' ||
                (body.provider !== 'paypal' && body.provider !== 'mercado_pago')
            );
            const stagingInvalid = environment === 'staging' && (
                Object.keys(body).sort().join('\0') !== stagingExpected.sort().join('\0') ||
                body.schema_version !== schema ||
                typeof body.external_subscription_id !== 'string' || !body.external_subscription_id
            );
            if (commonInvalid || liveInvalid || stagingInvalid) {
                throw new ListenerMembershipActionUnavailableError();
            }
        } catch (error) {
            if (error instanceof ListenerMembershipActionUnavailableError) throw error;
            throw new ListenerMembershipActionUnavailableError();
        } finally {
            clearTimeout(timeout);
        }
    }
}
