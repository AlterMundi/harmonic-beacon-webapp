import { AsyncLocalStorage } from 'node:async_hooks';

const oauthClientId = new AsyncLocalStorage<string | null>();

export function withAccountOAuthClient<T>(
    clientId: string | null,
    operation: () => Promise<T>,
): Promise<T> {
    return oauthClientId.run(clientId, operation);
}

export function currentAccountOAuthClient(): string | null {
    return oauthClientId.getStore() ?? null;
}

