import { describe, expect, it } from 'vitest';
import { accountProfileClaims } from '@/lib/account-profile-claims';

describe('provider-neutral Account profile claims', () => {
    it('does not require or infer a login provider', () => {
        const input = { name: '李', email: 'synthetic@example.test', email_verified: true, profile_complete: true };
        expect(accountProfileClaims(input)).toEqual({ preferredName: '李', email: input.email, emailVerified: true, profileComplete: true });
        expect(accountProfileClaims({ ...input, auth_method: 'google' })).toEqual(accountProfileClaims(input));
        expect(accountProfileClaims({ ...input, auth_method: 'email' })).toEqual(accountProfileClaims(input));
    });
    it('distinguishes unverified, unknown and absent email', () => {
        expect(accountProfileClaims({ email: 'synthetic@example.test', email_verified: false }).emailVerified).toBe(false);
        for (const verification of [undefined, null, 'true', 1]) {
            expect(accountProfileClaims({ email: 'synthetic@example.test', email_verified: verification }).emailVerified).toBeNull();
        }
        for (const email of [undefined, '', 'invalid', 'x@identity.invalid', 'x\n@example.test']) {
            expect(accountProfileClaims({ email, email_verified: true }).email).toBeNull();
            expect(accountProfileClaims({ email, email_verified: true }).emailVerified).toBeNull();
        }
    });
    it('requires explicit completeness and excludes private names from the public projection', () => {
        expect(accountProfileClaims({ name: 'Alias', real_name: 'Private' })).toEqual({
            preferredName: 'Alias', email: null, emailVerified: null, profileComplete: false,
        });
        expect(accountProfileClaims({ name: ' ', profile_complete: true }).profileComplete).toBe(false);
        expect(accountProfileClaims({ name: 'x'.repeat(61) }).preferredName).toBeNull();
        expect(accountProfileClaims({ name: 'Alias\u202e' }).preferredName).toBeNull();
    });
});
