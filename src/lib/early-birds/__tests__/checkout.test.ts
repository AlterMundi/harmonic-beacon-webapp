import { describe, expect, it, vi } from 'vitest';

import {
    HttpListenerCheckoutGateway,
    listenerCheckoutAvailability,
    ListenerCheckoutUnavailableError,
} from '../checkout';

const config = {
    baseUrl: 'http://pmp-myth-api:8765',
    keyId: 'beacon-listener-v1',
    token: 't'.repeat(43),
};
const base = {
    accountId: 'betterAuthOpaqueId_123',
    email: 'Listener@Example.COM ',
    attemptId: '123e4567-e89b-42d3-a456-426614174000',
    returnUrl: 'https://earlybirds-staging.harmonicbeacon.com/?checkout=returned',
    cancelUrl: 'https://earlybirds-staging.harmonicbeacon.com/?checkout=cancelled',
};

function result(provider: 'paypal' | 'mercado_pago', overrides: Record<string, unknown> = {}) {
    return {
        schema_version: 'early-bird-authority.checkout.v1',
        account_id: base.accountId,
        provider,
        external_subscription_id: 'sandbox-subscription-1',
        approval_url: provider === 'paypal'
            ? 'https://www.sandbox.paypal.com/checkoutnow?token=test'
            : 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=test',
        currency: provider === 'paypal' ? 'USD' : 'ARS',
        amount_minor: provider === 'paypal' ? 500 : 250000,
        sandbox: true,
        ...overrides,
    };
}

describe('Listener sandbox checkout gateway', () => {
    it('keeps both providers disabled unless each explicit flag is exactly 1', () => {
        expect(listenerCheckoutAvailability({} as NodeJS.ProcessEnv)).toEqual({
            paypal: false,
            mercadoPago: false,
        });
        expect(listenerCheckoutAvailability({
            NODE_ENV: 'test',
            BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED: '1',
            BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED: 'true',
        } as NodeJS.ProcessEnv)).toEqual({ paypal: true, mercadoPago: false });
        expect(listenerCheckoutAvailability({
            NODE_ENV: 'test',
            BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED: '1',
            BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED: 'true',
        } as NodeJS.ProcessEnv, 'live')).toEqual({ paypal: true, mercadoPago: false });
    });

    it('creates PayPal through v1 without sending email and keeps retries idempotent', async () => {
        const requests: Request[] = [];
        const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            requests.push(new Request(input, init));
            return Response.json(result('paypal'));
        });
        const gateway = new HttpListenerCheckoutGateway(config, request as typeof fetch);

        await gateway.create({ ...base, provider: 'paypal' });
        await gateway.create({ ...base, provider: 'paypal' });

        expect(requests).toHaveLength(2);
        expect(requests[0].url).toBe('http://pmp-myth-api:8765/api/internal/v1/early-bird-checkouts');
        const body = await requests[0].json();
        expect(body).toEqual({
            schema_version: 'early-bird-authority.checkout-create.v1',
            account_id: base.accountId,
            provider: 'paypal',
            return_url: base.returnUrl,
            cancel_url: base.cancelUrl,
        });
        expect(JSON.stringify(body)).not.toContain('Listener@');
        expect(requests[0].headers.get('idempotency-key'))
            .toBe(requests[1].headers.get('idempotency-key'));
    });

    it('creates Mercado Pago through v2 with only the normalized session email', async () => {
        let captured: Request | null = null;
        const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            captured = new Request(input, init);
            return Response.json(result('mercado_pago'));
        });
        const gateway = new HttpListenerCheckoutGateway(config, request as typeof fetch);
        const created = await gateway.create({ ...base, provider: 'mercado_pago' });

        expect(created).toEqual({
            provider: 'mercado_pago',
            approvalUrl: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=test',
        });
        expect(captured!.url).toBe('http://pmp-myth-api:8765/api/internal/v2/early-bird-checkouts');
        expect(await captured!.json()).toEqual(expect.objectContaining({
            schema_version: 'early-bird-checkout.checkout-create.v2',
            account_id: base.accountId,
            provider: 'mercado_pago',
            payer_email: 'listener@example.com',
        }));
    });

    it.each([
        ['non-sandbox', { sandbox: false }],
        ['wrong account', { account_id: 'another-account' }],
        ['wrong provider', { provider: 'mercado_pago' }],
        ['wrong currency', { currency: 'ARS' }],
        ['credential URL', { approval_url: 'https://user@www.sandbox.paypal.com/checkout' }],
        ['unofficial URL', { approval_url: 'https://sandbox-paypal.example/checkout' }],
        ['unknown property', { buyer_email: 'pii@example.invalid' }],
    ])('rejects %s authority responses', async (_label, overrides) => {
        const request = vi.fn(async () => Response.json(result('paypal', overrides)));
        const gateway = new HttpListenerCheckoutGateway(config, request as typeof fetch);
        await expect(gateway.create({ ...base, provider: 'paypal' }))
            .rejects.toBeInstanceOf(ListenerCheckoutUnavailableError);
    });

    it('rejects oversized responses before parsing or redirecting', async () => {
        const request = vi.fn(async () => new Response('{}', {
            headers: { 'Content-Type': 'application/json', 'Content-Length': '70000' },
        }));
        const gateway = new HttpListenerCheckoutGateway(config, request as typeof fetch);
        await expect(gateway.create({ ...base, provider: 'paypal' }))
            .rejects.toBeInstanceOf(ListenerCheckoutUnavailableError);
    });

    it('uses the unified Live contract and strips provider subscription identity', async () => {
        const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const captured = new Request(input, init);
            expect(captured.url).toBe('http://pmp-myth-api:8765/api/internal/v1/listener-checkouts');
            await expect(captured.json()).resolves.toEqual({
                schema_version: 'listener-checkout.checkout-create.v1',
                account_id: base.accountId,
                provider: 'paypal',
                payer_email: null,
                return_url: base.returnUrl,
                cancel_url: base.cancelUrl,
            });
            return Response.json({
                schema_version: 'listener-checkout.checkout.v1',
                account_id: base.accountId,
                provider: 'paypal',
                approval_url: 'https://www.paypal.com/checkoutnow?token=live',
                currency: 'USD',
                amount_minor: 500,
                environment: 'live',
            });
        });
        const gateway = new HttpListenerCheckoutGateway(config, request as typeof fetch);
        await expect(gateway.create({ ...base, provider: 'paypal', environment: 'live' })).resolves.toEqual({
            provider: 'paypal',
            approvalUrl: 'https://www.paypal.com/checkoutnow?token=live',
        });
    });

    it.each([
        ['sandbox response', { environment: 'staging' }],
        ['wrong PayPal price', { amount_minor: 700 }],
        ['sandbox PayPal host', { approval_url: 'https://www.sandbox.paypal.com/checkout' }],
        ['provider identity leak', { external_subscription_id: 'I-secret' }],
    ])('rejects %s on the Live boundary', async (_label, override) => {
        const request = vi.fn(async () => Response.json({
            schema_version: 'listener-checkout.checkout.v1',
            account_id: base.accountId,
            provider: 'paypal',
            approval_url: 'https://www.paypal.com/checkoutnow?token=live',
            currency: 'USD',
            amount_minor: 500,
            environment: 'live',
            ...override,
        }));
        const gateway = new HttpListenerCheckoutGateway(config, request as typeof fetch);
        await expect(gateway.create({ ...base, provider: 'paypal', environment: 'live' }))
            .rejects.toBeInstanceOf(ListenerCheckoutUnavailableError);
    });
});
