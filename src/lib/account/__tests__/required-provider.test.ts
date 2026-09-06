import { describe, expect, it } from 'vitest';

import { requiredProviderFromSignedQuery } from '../required-provider';

describe('Google-only product login UI marker', () => {
    it.each(['hb-live', 'hb-live-staging'])('accepts a signed login prompt from %s', (clientId) => {
        expect(requiredProviderFromSignedQuery({
            prompt: 'login',
            client_id: clientId,
            sig: 'signed-query',
            exp: '1788656400',
        })).toBe('google');
    });

    it.each([
        [{ prompt: 'login', client_id: 'hb-live', exp: '1788656400' }],
        [{ prompt: 'login', client_id: 'unknown', sig: 'signed-query', exp: '1788656400' }],
        [{ prompt: 'consent', client_id: 'hb-live', sig: 'signed-query', exp: '1788656400' }],
    ])('does not restrict the UI for an untrusted or incomplete query', (query) => {
        expect(requiredProviderFromSignedQuery(query)).toBeNull();
    });
});
