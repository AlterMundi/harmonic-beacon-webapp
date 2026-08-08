import { describe, expect, it } from 'vitest';

import {
    canonicalEarlyBirdInvitation,
    clearedEarlyBirdInvitationCookie,
    earlyBirdInvitationCookieHost,
    earlyBirdInvitationHost,
    earlyBirdInvitationCookie,
    earlyBirdInvitationStagingHost,
    EARLY_BIRD_INVITATION_COOKIE,
    EARLY_BIRD_INVITATION_MAX_AGE_SECONDS,
    LISTENER_INVITATION_COOKIE,
    listenerInvitationCookies,
    listenerInvitationFromCookieHeader,
    clearedListenerInvitationCookies,
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
        const dualCookies = listenerInvitationCookies(TOKEN);
        expect(dualCookies.map(({ name }) => name)).toEqual([
            LISTENER_INVITATION_COOKIE,
            EARLY_BIRD_INVITATION_COOKIE,
        ]);
        for (const cookie of dualCookies) {
            expect(cookie).toMatchObject({
                value: TOKEN,
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                path: '/',
                maxAge: EARLY_BIRD_INVITATION_MAX_AGE_SECONDS,
            });
            expect(cookie).not.toHaveProperty('domain');
        }
        expect(clearedListenerInvitationCookies()).toHaveLength(2);
    });

    it('reads equal dual cookies and accepts a valid legacy-only fallback', () => {
        const other = `ebi_v1.${'d'.repeat(32)}.${'e'.repeat(32)}.${'f'.repeat(32)}`;
        expect(listenerInvitationFromCookieHeader(
            `${EARLY_BIRD_INVITATION_COOKIE}=${TOKEN}`,
        )).toBe(TOKEN);
        expect(listenerInvitationFromCookieHeader(
            `${LISTENER_INVITATION_COOKIE}=${TOKEN}; ${EARLY_BIRD_INVITATION_COOKIE}=${TOKEN}`,
        )).toBe(TOKEN);
        expect(listenerInvitationFromCookieHeader(
            `${LISTENER_INVITATION_COOKIE}=${other}; ${EARLY_BIRD_INVITATION_COOKIE}=${TOKEN}`,
        )).toBeNull();
        expect(listenerInvitationFromCookieHeader(
            `${LISTENER_INVITATION_COOKIE}=invalid; ${EARLY_BIRD_INVITATION_COOKIE}=${TOKEN}`,
        )).toBeNull();
    });

    it('fails closed on duplicate same-name cookies before considering either generation', () => {
        expect(listenerInvitationFromCookieHeader(
            `${LISTENER_INVITATION_COOKIE}=${TOKEN}; ${LISTENER_INVITATION_COOKIE}=${TOKEN}; ${EARLY_BIRD_INVITATION_COOKIE}=${TOKEN}`,
        )).toBeNull();
    });

    it('accepts invitation entry only on the exact Listener product and staging hosts', () => {
        expect(earlyBirdInvitationHost('listen.harmonicbeacon.com')).toBe(true);
        expect(earlyBirdInvitationHost('earlybirds-staging.harmonicbeacon.com')).toBe(true);
        expect(earlyBirdInvitationHost('LISTEN.HARMONICBEACON.COM')).toBe(true);
        expect(earlyBirdInvitationHost('live.harmonicbeacon.com')).toBe(false);
        expect(earlyBirdInvitationHost('listen.harmonicbeacon.com.attacker.invalid')).toBe(false);
        expect(earlyBirdInvitationCookieHost('listen.harmonicbeacon.com')).toBe(true);
        expect(earlyBirdInvitationCookieHost('earlybirds-staging.harmonicbeacon.com')).toBe(false);
        expect(earlyBirdInvitationStagingHost('earlybirds-staging.harmonicbeacon.com')).toBe(true);
        expect(earlyBirdInvitationStagingHost('listen.harmonicbeacon.com')).toBe(false);
    });
});
