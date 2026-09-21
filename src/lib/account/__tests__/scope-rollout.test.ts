import { describe, expect, it } from 'vitest';
import { ACCOUNT_PROVISIONED_SCOPES, accountClientScopesCompatible } from '../config';

describe('Account scope rollout recovery', () => {
    it('keeps phase-one provisioning compatible with the prior production image', () => {
        expect(ACCOUNT_PROVISIONED_SCOPES).toEqual(['openid', 'profile']);
    });
    it.each([
        [['openid', 'profile'], true],
        [['openid', 'profile', 'email'], true],
        [['openid'], false],
        [['profile', 'openid'], false],
        [['openid', 'profile', 'admin'], false],
        [['openid', 'profile', 'email', 'admin'], false],
        [['openid', 'profile', 'profile'], false],
    ] as [string[], boolean][])('validates the exact inventory %j', (scopes, expected) => {
        expect(accountClientScopesCompatible(scopes)).toBe(expected);
    });
});
