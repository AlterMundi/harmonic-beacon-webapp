import { describe, expect, it } from 'vitest';
import { ACCOUNT_PROVISIONED_SCOPES, accountClientScopesCompatible } from '../config';

describe('Account scope rollout recovery', () => {
    it('provisions the exact phase-two email scope inventory', () => {
        expect(ACCOUNT_PROVISIONED_SCOPES).toEqual(['openid', 'profile', 'email']);
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
