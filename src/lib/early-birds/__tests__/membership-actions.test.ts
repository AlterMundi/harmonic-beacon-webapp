import { describe, expect, it, vi } from 'vitest';

import {
    HttpListenerMembershipActionsGateway,
    ListenerMembershipActionUnavailableError,
} from '../membership-actions';

const config = {
    baseUrl: 'http://pmp-myth-api:8765',
    keyId: 'beacon-listener-v1',
    token: 't'.repeat(43),
};
const input = {
    accountId: 'betterAuthOpaqueId_123',
    attemptId: '123e4567-e89b-42d3-a456-426614174000',
};

describe('Listener membership actions gateway', () => {
    it('queues cancellation with opaque account identity and a stable idempotency key', async () => {
        const requests: Request[] = [];
        const request = vi.fn(async (target: string | URL | Request, init?: RequestInit) => {
            requests.push(new Request(target, init));
            return Response.json({
                schema_version: 'listener-membership.action-result.v1',
                status: 'queued',
                account_id: input.accountId,
                provider: 'paypal',
                action: 'cancel',
                job_id: 'private-job-id',
            }, { status: 202 });
        });
        const gateway = new HttpListenerMembershipActionsGateway(config, request as typeof fetch);
        await gateway.requestAction({ ...input, action: 'cancel' });
        await gateway.requestAction({ ...input, action: 'cancel' });

        expect(requests).toHaveLength(2);
        expect(requests[0].url).toBe('http://pmp-myth-api:8765/api/internal/v1/listener-membership-actions');
        await expect(requests[0].json()).resolves.toEqual({
            schema_version: 'listener-membership.action.v1',
            account_id: input.accountId,
            action: 'cancel',
        });
        expect(requests[0].headers.get('idempotency-key'))
            .toBe(requests[1].headers.get('idempotency-key'));
    });

    it.each([
        ['wrong account', { account_id: 'another-account' }],
        ['wrong action', { action: 'reactivate' }],
        ['wrong status', { status: 'done' }],
        ['unknown field', { external_subscription_id: 'private' }],
    ])('fails closed on %s', async (_label, override) => {
        const request = vi.fn(async () => Response.json({
            schema_version: 'listener-membership.action-result.v1',
            status: 'queued',
            account_id: input.accountId,
            provider: 'paypal',
            action: 'cancel',
            job_id: 'private-job-id',
            ...override,
        }, { status: 202 }));
        const gateway = new HttpListenerMembershipActionsGateway(config, request as typeof fetch);
        await expect(gateway.requestAction({ ...input, action: 'cancel' })).rejects
            .toBeInstanceOf(ListenerMembershipActionUnavailableError);
    });

    it('uses the server-selected provider only for the isolated staging lifecycle', async () => {
        const request = vi.fn(async (target: string | URL | Request, init?: RequestInit) => {
            const captured = new Request(target, init);
            expect(captured.url).toBe('http://pmp-myth-api:8765/api/internal/v1/early-bird-mercado-pago-actions');
            await expect(captured.json()).resolves.toEqual({
                schema_version: 'early-bird-mercado-pago-lifecycle.command.v1',
                account_id: input.accountId,
                action: 'pause',
            });
            return Response.json({
                schema_version: 'early-bird-mercado-pago-lifecycle.response.v1',
                status: 'queued',
                account_id: input.accountId,
                action: 'pause',
                external_subscription_id: 'private-and-discarded',
                job_id: 'private-job-id',
            }, { status: 202 });
        });
        const gateway = new HttpListenerMembershipActionsGateway(config, request as typeof fetch);
        await expect(gateway.requestAction({
            ...input,
            action: 'cancel',
            environment: 'staging',
            provider: 'mercado_pago',
        })).resolves.toBeUndefined();
    });

    it.each([
        ['paypal', 'activate', 'early-bird-paypal-lifecycle.command.v1', 'early-bird-paypal-lifecycle.response.v1'],
        ['mercado_pago', 'reactivate', 'early-bird-mercado-pago-lifecycle.command.v1', 'early-bird-mercado-pago-lifecycle.response.v1'],
    ] as const)(
        'maps canonical reactivation to the %s staging lifecycle',
        async (provider, providerAction, commandSchema, responseSchema) => {
            const request = vi.fn(async (target: string | URL | Request, init?: RequestInit) => {
                const captured = new Request(target, init);
                await expect(captured.json()).resolves.toEqual({
                    schema_version: commandSchema,
                    account_id: input.accountId,
                    action: providerAction,
                });
                return Response.json({
                    schema_version: responseSchema,
                    status: 'queued',
                    account_id: input.accountId,
                    action: providerAction,
                    external_subscription_id: 'private-and-discarded',
                    job_id: 'private-job-id',
                }, { status: 202 });
            });
            const gateway = new HttpListenerMembershipActionsGateway(config, request as typeof fetch);
            await expect(gateway.requestAction({
                ...input,
                action: 'reactivate',
                environment: 'staging',
                provider,
            })).resolves.toBeUndefined();
        },
    );

    it('uses distinct idempotency keys for cancel and reactivate', async () => {
        const keys: string[] = [];
        const request = vi.fn(async (_target: string | URL | Request, init?: RequestInit) => {
            const captured = new Request('http://pmp-myth-api:8765', init);
            keys.push(captured.headers.get('idempotency-key') ?? '');
            const action = JSON.parse(String(init?.body)).action as 'cancel' | 'reactivate';
            return Response.json({
                schema_version: 'listener-membership.action-result.v1',
                status: 'queued',
                account_id: input.accountId,
                provider: 'paypal',
                action,
                job_id: 'private-job-id',
            }, { status: 202 });
        });
        const gateway = new HttpListenerMembershipActionsGateway(config, request as typeof fetch);
        await gateway.requestAction({ ...input, action: 'cancel' });
        await gateway.requestAction({ ...input, action: 'reactivate' });
        expect(keys[0]).toBeTruthy();
        expect(keys[1]).toBeTruthy();
        expect(keys[0]).not.toBe(keys[1]);
    });
});
