import { describe, expect, it } from 'vitest';

import {
    signAccountLogoutInitiation,
    verifyAccountLogoutInitiation,
} from '@/lib/account/frontchannel-token';

const issuer = 'https://account.harmonicbeacon.com';
const clientId = 'hb-listener';
const clientSecret = 'listener-client-secret-with-at-least-32-characters';
const sid = 'central-session-id';
const returnTo = 'https://listen.harmonicbeacon.com/';
const now = new Date('2026-08-17T20:00:00.000Z');

function signed(overrides: Partial<Parameters<typeof signAccountLogoutInitiation>[0]> = {}) {
    return signAccountLogoutInitiation({
        issuer, clientId, clientSecret, sid, mode: 'current', returnTo, now,
        ...overrides,
    });
}

function verify(token: string, overrides: Partial<Parameters<typeof verifyAccountLogoutInitiation>[0]> = {}) {
    return verifyAccountLogoutInitiation({
        token, issuer, clientId, clientSecret, sid, mode: 'current', returnTo, now,
        ...overrides,
    });
}

describe('signed RP → Account logout initiation', () => {
    it('accepts the exact bounded contract', () => expect(verify(signed())).toBe(true));

    it('rejects tamper, wrong signer and expired tokens', () => {
        const token = signed();
        const replacement = token.endsWith('A') ? 'B' : 'A';
        expect(verify(`${token.slice(0, -1)}${replacement}`)).toBe(false);
        expect(verify(token, { clientSecret: 'wrong-secret-with-at-least-32-characters' })).toBe(false);
        expect(verify(token, { now: new Date(now.getTime() + 121_000) })).toBe(false);
    });

    it.each([
        ['issuer', { issuer: 'https://account-staging.harmonicbeacon.com' }],
        ['client', { clientId: 'hb-live' }],
        ['sid', { sid: 'another-session' }],
        ['mode', { mode: 'all' as const }],
        ['return_to', { returnTo: 'https://live.harmonicbeacon.com/' }],
    ])('rejects a token with the wrong %s binding', (_label, changed) => {
        expect(verify(signed(changed))).toBe(false);
    });
});
