import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    headers: vi.fn(),
    currentEarlyBirdSession: vi.fn(),
    redirect: vi.fn((target: string) => {
        throw new Error(`REDIRECT:${target}`);
    }),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/early-birds/auth', () => ({
    currentEarlyBirdSession: mocks.currentEarlyBirdSession,
}));

import FreeInvitationRedeemer from '@/components/early-birds/FreeInvitationRedeemer';
import {
    EARLY_BIRD_INVITATION_COOKIE,
    LISTENER_INVITATION_COOKIE,
} from '@/lib/early-birds/invitation-cookie';
import EarlyBirdRedeemPage from '../page';

const TOKEN = `ebi_v1.${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`;

function cookieHeaders(entries: Array<[string, string]>) {
    return new Headers({
        cookie: entries.map(([name, value]) => `${name}=${value}`).join('; '),
    });
}

beforeEach(() => {
    vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
    mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('Listener invitation redeem page compatibility', () => {
    it.each([
        [LISTENER_INVITATION_COOKIE],
        [EARLY_BIRD_INVITATION_COOKIE],
    ])('accepts an authenticated %s-only handoff', async (name) => {
        mocks.headers.mockResolvedValue(cookieHeaders([[name, TOKEN]]));

        const result = await EarlyBirdRedeemPage();

        expect(result.type).toBe(FreeInvitationRedeemer);
        expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it('accepts equal dual cookies', async () => {
        mocks.headers.mockResolvedValue(cookieHeaders([
            [LISTENER_INVITATION_COOKIE, TOKEN],
            [EARLY_BIRD_INVITATION_COOKIE, TOKEN],
        ]));

        const result = await EarlyBirdRedeemPage();

        expect(result.type).toBe(FreeInvitationRedeemer);
    });

    it('fails closed before auth when generations conflict or a name is duplicated', async () => {
        const other = `ebi_v1.${'d'.repeat(32)}.${'e'.repeat(32)}.${'f'.repeat(32)}`;
        for (const entries of [
            [
                [LISTENER_INVITATION_COOKIE, other],
                [EARLY_BIRD_INVITATION_COOKIE, TOKEN],
            ],
            [
                [LISTENER_INVITATION_COOKIE, TOKEN],
                [LISTENER_INVITATION_COOKIE, TOKEN],
            ],
        ] as Array<Array<[string, string]>>) {
            mocks.headers.mockResolvedValueOnce(cookieHeaders(entries));
            await expect(EarlyBirdRedeemPage()).rejects.toThrow('REDIRECT:/listener');
        }
        expect(mocks.currentEarlyBirdSession).not.toHaveBeenCalled();
    });
});
