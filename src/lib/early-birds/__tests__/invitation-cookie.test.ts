import { describe, expect, it } from 'vitest';

import {
    canonicalEarlyBirdInvitation,
    clearedEarlyBirdInvitationCookie,
    earlyBirdInvitationCookie,
    EARLY_BIRD_INVITATION_COOKIE,
} from '@/lib/early-birds/invitation-cookie';

const TOKEN = `ebi_v1.${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`;

describe('EarlyBird invitation handoff cookie', () => {
    it('accepts only the bounded canonical authority token shape', () => {
        expect(canonicalEarlyBirdInvitation(TOKEN)).toBe(TOKEN);
        expect(canonicalEarlyBirdInvitation('a'.repeat(43))).toBeNull();
        expect(canonicalEarlyBirdInvitation(`ebi_v1.${'a'.repeat(510)}`)).toBeNull();
        expect(canonicalEarlyBirdInvitation(null)).toBeNull();
    });

    it('uses a short host-only browser-inaccessible cookie and clears with matching scope', () => {
        expect(earlyBirdInvitationCookie(TOKEN)).toMatchObject({
            name: EARLY_BIRD_INVITATION_COOKIE,
            value: TOKEN,
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
        });
        expect(clearedEarlyBirdInvitationCookie()).toMatchObject({
            name: EARLY_BIRD_INVITATION_COOKIE,
            value: '',
            maxAge: 0,
            path: '/',
        });
    });
});
