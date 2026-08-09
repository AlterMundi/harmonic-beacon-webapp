import { createHash } from 'node:crypto';

import { isEarlyBirdAccountId } from './account-id';

export type ListenerCheckoutProvider = 'paypal' | 'mercado_pago';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export class ListenerCheckoutUnavailableError extends Error {
    constructor() {
        super('Listener sandbox checkout is unavailable');
        this.name = 'ListenerCheckoutUnavailableError';
    }
}

export type ListenerCheckoutResult = {
    provider: ListenerCheckoutProvider;
    approvalUrl: string;
};

export function listenerCheckoutAvailability(environment: NodeJS.ProcessEnv = process.env) {
    return {
        paypal: environment.BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED === '1',
        mercadoPago: environment.BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED === '1',
    } as const;
}

function normalizedEmail(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (normalized.length < 3 || normalized.length > 320 ||
        normalized.split('@').length !== 2 || /[\s\x00-\x20\x7f]/.test(normalized)) {
        throw new ListenerCheckoutUnavailableError();
    }
    return normalized;
}

function authorityConfig(environment: NodeJS.ProcessEnv = process.env) {
    const rawBaseUrl = environment.EARLY_BIRDS_AUTHORITY_BASE_URL?.trim();
    const keyId = environment.EARLY_BIRDS_AUTHORITY_SERVICE_KEY_ID?.trim();
    const token = environment.EARLY_BIRDS_AUTHORITY_SERVICE_TOKEN?.trim();
    if (!rawBaseUrl || !keyId || !token || token.length < 43) {
        throw new ListenerCheckoutUnavailableError();
    }
    let baseUrl: URL;
    try {
        baseUrl = new URL(rawBaseUrl);
    } catch {
        throw new ListenerCheckoutUnavailableError();
    }
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
        throw new ListenerCheckoutUnavailableError();
    }
    return { baseUrl: baseUrl.toString().replace(/\/$/, ''), keyId, token };
}

async function boundedJson(response: Response): Promise<unknown> {
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
        await response.body?.cancel().catch(() => undefined);
        throw new ListenerCheckoutUnavailableError();
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ListenerCheckoutUnavailableError();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
                await reader.cancel().catch(() => undefined);
                throw new ListenerCheckoutUnavailableError();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
    } catch {
        throw new ListenerCheckoutUnavailableError();
    }
}

function checkoutResult(
    raw: unknown,
    accountId: string,
    provider: ListenerCheckoutProvider,
): ListenerCheckoutResult {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ListenerCheckoutUnavailableError();
    }
    const input = raw as Record<string, unknown>;
    const expectedKeys = [
        'account_id', 'amount_minor', 'approval_url', 'currency',
        'external_subscription_id', 'provider', 'sandbox', 'schema_version',
    ];
    if (Object.keys(input).sort().join('\0') !== expectedKeys.sort().join('\0') ||
        input.schema_version !== 'early-bird-authority.checkout.v1' ||
        input.account_id !== accountId || input.provider !== provider || input.sandbox !== true ||
        !Number.isSafeInteger(input.amount_minor) || Number(input.amount_minor) <= 0 ||
        typeof input.external_subscription_id !== 'string' || !input.external_subscription_id ||
        (provider === 'paypal' ? input.currency !== 'USD' : input.currency !== 'ARS') ||
        typeof input.approval_url !== 'string') {
        throw new ListenerCheckoutUnavailableError();
    }
    let approval: URL;
    try {
        approval = new URL(input.approval_url);
    } catch {
        throw new ListenerCheckoutUnavailableError();
    }
    const allowedHost = provider === 'paypal'
        ? approval.hostname === 'sandbox.paypal.com' || approval.hostname.endsWith('.sandbox.paypal.com')
        : approval.hostname === 'www.mercadopago.com.ar';
    if (approval.protocol !== 'https:' || approval.username || approval.password || !allowedHost ||
        input.approval_url.length > 2048) {
        throw new ListenerCheckoutUnavailableError();
    }
    return { provider, approvalUrl: approval.toString() };
}

function idempotencyKey(accountId: string, provider: ListenerCheckoutProvider, attemptId: string): string {
    const digest = createHash('sha256')
        .update(`listener-checkout-v1\n${accountId}\n${provider}\n${attemptId}`)
        .digest('hex');
    return `listener-checkout:${digest}`;
}

export class HttpListenerCheckoutGateway {
    constructor(
        private readonly config = authorityConfig(),
        private readonly request: typeof fetch = fetch,
    ) {}

    async create(input: {
        accountId: string;
        email: string;
        provider: ListenerCheckoutProvider;
        attemptId: string;
        returnUrl: string;
        cancelUrl: string;
    }): Promise<ListenerCheckoutResult> {
        if (!isEarlyBirdAccountId(input.accountId) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.attemptId)) {
            throw new ListenerCheckoutUnavailableError();
        }
        const endpoint = input.provider === 'paypal'
            ? '/api/internal/v1/early-bird-checkouts'
            : '/api/internal/v2/early-bird-checkouts';
        const payload = input.provider === 'paypal' ? {
            schema_version: 'early-bird-authority.checkout-create.v1',
            account_id: input.accountId,
            provider: input.provider,
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
        } : {
            schema_version: 'early-bird-checkout.checkout-create.v2',
            account_id: input.accountId,
            provider: input.provider,
            payer_email: normalizedEmail(input.email),
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await this.request(`${this.config.baseUrl}${endpoint}`, {
                method: 'POST',
                redirect: 'error',
                cache: 'no-store',
                signal: controller.signal,
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${this.config.token}`,
                    'content-type': 'application/json',
                    'idempotency-key': idempotencyKey(input.accountId, input.provider, input.attemptId),
                    'x-hb-service-key-id': this.config.keyId,
                },
                body: JSON.stringify(payload),
            });
            if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
                await response.body?.cancel().catch(() => undefined);
                throw new ListenerCheckoutUnavailableError();
            }
            return checkoutResult(await boundedJson(response), input.accountId, input.provider);
        } catch (error) {
            if (error instanceof ListenerCheckoutUnavailableError) throw error;
            throw new ListenerCheckoutUnavailableError();
        } finally {
            clearTimeout(timeout);
        }
    }
}
