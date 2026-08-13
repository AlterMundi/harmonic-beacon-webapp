import {
    createHmac,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';

import { isEarlyBirdAccountId } from './account-id';
import type { ListenerCheckoutProvider } from './checkout';

const TOKEN_VERSION = 'listener-live-workbench-csrf-v1';
const TOKEN_TTL_SECONDS = 15 * 60;
const MIN_SECRET_LENGTH = 43;
const MAX_SECRET_LENGTH = 512;
const NONCE_BYTES = 24;

export const LISTENER_LIVE_WORKBENCH_CSRF_HEADER = 'x-hb-listener-live-csrf';

type Environment = Record<string, string | undefined>;

const WORKBENCH_VARIABLES = [
    'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED',
    'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID',
    'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER',
    'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET',
] as const;

export class ListenerLiveWorkbenchConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ListenerLiveWorkbenchConfigurationError';
    }
}

export type ListenerLiveWorkbenchConfig = {
    accountId: string;
    provider: ListenerCheckoutProvider;
    csrfSecret: string;
};

function configured(value: string | undefined): string | null {
    if (!value || value !== value.trim()) return null;
    return value;
}

/**
 * Resolve the supervised Live checkout seam. This is deliberately a separate,
 * canonical-only configuration generation: the pre-release workbench has no
 * legacy aliases and a partial or ambiguous configuration is inert.
 */
export function listenerLiveWorkbenchConfig(
    environment: Environment = process.env,
): ListenerLiveWorkbenchConfig | null {
    if (environment.BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED !== '1') return null;

    // Public Live checkout and the staging-only workbench must never coexist.
    if (environment.BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED === '1' ||
        environment.BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED === '1') return null;

    const accountId = configured(
        environment.BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID,
    );
    const provider = configured(
        environment.BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER,
    );
    const csrfSecret = configured(
        environment.BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET,
    );
    if (!isEarlyBirdAccountId(accountId) ||
        (provider !== 'paypal' && provider !== 'mercado_pago') ||
        !csrfSecret || csrfSecret.length < MIN_SECRET_LENGTH ||
        csrfSecret.length > MAX_SECRET_LENGTH) return null;

    return { accountId, provider, csrfSecret };
}

/** Validate deployment shape without ever including configured values in diagnostics. */
export function validateListenerLiveWorkbenchEnvironment(
    environment: Environment = process.env,
): boolean {
    const present = WORKBENCH_VARIABLES.some((name) => environment[name] !== undefined);
    if (!present) return false;
    const enabled = environment.BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED;
    if (enabled !== '0' && enabled !== '1') {
        throw new ListenerLiveWorkbenchConfigurationError(
            'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED must be exactly 0 or 1',
        );
    }
    if (enabled === '0') return false;
    if (!listenerLiveWorkbenchConfig(environment)) {
        throw new ListenerLiveWorkbenchConfigurationError(
            'Enabled private Live workbench requires one valid account, one provider, one CSRF secret and both public Live flags OFF',
        );
    }
    return true;
}

function signatureInput(input: {
    accountId: string;
    sessionId: string;
    provider: ListenerCheckoutProvider;
    expiresAtSeconds: number;
    nonce: string;
}): string {
    return [
        TOKEN_VERSION,
        input.accountId,
        input.sessionId,
        input.provider,
        String(input.expiresAtSeconds),
        input.nonce,
    ].join('\n');
}

function signature(secret: string, value: string): Buffer {
    return createHmac('sha256', secret).update(value).digest();
}

export function createListenerLiveWorkbenchCsrfToken(input: {
    config: ListenerLiveWorkbenchConfig;
    accountId: string;
    sessionId: string;
    now?: Date;
}): string | null {
    if (input.accountId !== input.config.accountId || !input.sessionId) return null;
    const expiresAtSeconds = Math.floor(
        (input.now?.getTime() ?? Date.now()) / 1000,
    ) + TOKEN_TTL_SECONDS;
    const nonce = randomBytes(NONCE_BYTES).toString('base64url');
    const mac = signature(input.config.csrfSecret, signatureInput({
        accountId: input.accountId,
        sessionId: input.sessionId,
        provider: input.config.provider,
        expiresAtSeconds,
        nonce,
    })).toString('base64url');
    return `${expiresAtSeconds}.${nonce}.${mac}`;
}

export function verifyListenerLiveWorkbenchCsrfToken(input: {
    config: ListenerLiveWorkbenchConfig;
    token: string | null;
    accountId: string;
    sessionId: string;
    now?: Date;
}): boolean {
    if (input.accountId !== input.config.accountId || !input.sessionId || !input.token ||
        input.token.length > 256) return false;
    const parts = input.token.split('.');
    if (parts.length !== 3 || !/^\d{10}$/.test(parts[0]) ||
        !/^[A-Za-z0-9_-]{32}$/.test(parts[1]) ||
        !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return false;

    const expiresAtSeconds = Number(parts[0]);
    const nowSeconds = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
    if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds < nowSeconds ||
        expiresAtSeconds > nowSeconds + TOKEN_TTL_SECONDS) return false;

    const expected = signature(input.config.csrfSecret, signatureInput({
        accountId: input.accountId,
        sessionId: input.sessionId,
        provider: input.config.provider,
        expiresAtSeconds,
        nonce: parts[1],
    }));
    let supplied: Buffer;
    try {
        supplied = Buffer.from(parts[2], 'base64url');
    } catch {
        return false;
    }
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
