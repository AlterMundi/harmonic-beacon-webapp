import { accountOrigin } from '@/lib/account/config';

export const ACCOUNT_MAIL_DELIVERY_PATH = '/api/internal/v1/listener-account-mail/deliver';
export const ACCOUNT_MAIL_DELIVERY_URL = `http://listener-mail-api:8765${ACCOUNT_MAIL_DELIVERY_PATH}`;
export const ACCOUNT_MAIL_READINESS_URL = 'http://listener-mail-api:8765/ready';

type AccountMailPurpose = 'verify_email' | 'reset_password' | 'change_email';

function mailConfiguration(environment: NodeJS.ProcessEnv = process.env) {
    const token = environment.BEACON_ACCOUNT_MAIL_DELIVERY_TOKEN?.trim();
    if (!token || token.length < 32) {
        return null;
    }
    return { url: ACCOUNT_MAIL_DELIVERY_URL, token };
}

export async function accountMailReady(
    environment: NodeJS.ProcessEnv = process.env,
    request: typeof fetch = fetch,
): Promise<boolean> {
    try {
        if (!mailConfiguration(environment)) return false;
        const response = await request(ACCOUNT_MAIL_READINESS_URL, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) return false;
        const body = await response.json().catch(() => null) as { status?: unknown } | null;
        return body?.status === 'ready';
    } catch {
        return false;
    }
}

export async function deliverAccountActionEmail(input: {
    recipient: string;
    purpose: AccountMailPurpose;
    token: string;
    expiresAt: Date;
    locale?: 'es' | 'en';
    idempotencyKey: string;
}): Promise<void> {
    const configuration = mailConfiguration();
    if (!configuration) throw new Error('Account email delivery is unavailable');
    const page = input.purpose === 'reset_password' ? '/reset-password' : '/verify-email';
    const actionURL = `${accountOrigin()}${page}?token=${encodeURIComponent(input.token)}`;
    if (!/^[0-9a-f]{64}$/.test(input.idempotencyKey)) {
        throw new Error('Account email idempotency key must be 64 lowercase hexadecimal characters');
    }
    const response = await fetch(configuration.url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${configuration.token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
            contract_version: input.purpose === 'verify_email'
                ? 'listener-email-verification.v1'
                : input.purpose === 'reset_password'
                    ? 'listener-password-reset.v1'
                    : 'listener-email-change.v1',
            purpose: input.purpose,
            recipient: input.recipient.trim().toLowerCase(),
            locale: input.locale === 'es' ? 'es' : 'en',
            action_url: actionURL,
            expires_at: input.expiresAt.toISOString(),
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error('Account email delivery failed');
}
