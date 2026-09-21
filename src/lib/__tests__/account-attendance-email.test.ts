import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AMPLIFICATION_CREDIT_EMAIL_MAX_CHARS,
    convergeVerifiedAccountAttendanceEmail,
} from '@/lib/account-attendance-email';

const updateMany = vi.fn();
const tx = {
    ticketEntitlement: { updateMany },
} as unknown as Pick<Prisma.TransactionClient, 'ticketEntitlement'>;

const identity = {
    issuer: 'https://account.example.test',
    subject: 'opaque-account-subject',
    email: 'verified@example.test',
    emailVerified: true,
};

describe('verified Account attendance email convergence', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        updateMany.mockResolvedValue({ count: 2 });
    });

    it('fills only missing exact-subject public free attendance snapshots', async () => {
        await expect(convergeVerifiedAccountAttendanceEmail(tx, identity)).resolves.toBe(2);
        expect(updateMany).toHaveBeenCalledWith({
            where: {
                accountIssuer: identity.issuer,
                accountId: identity.subject,
                accountEmail: null,
                accountEmailVerified: null,
                boundEmail: null,
                tier: 'COMP',
                codeLastFour: 'FREE',
                scheduledSession: { is: { publicAccess: true } },
                commerceEntitlement: { is: null },
            },
            data: {
                accountEmail: identity.email,
                accountEmailVerified: true,
            },
        });
    });

    it.each([
        { candidate: { ...identity, email: null }, label: 'missing email' },
        { candidate: { ...identity, emailVerified: false }, label: 'unverified email' },
        { candidate: { ...identity, emailVerified: null }, label: 'unknown verification' },
        {
            candidate: { ...identity, email: `a@${'x'.repeat(AMPLIFICATION_CREDIT_EMAIL_MAX_CHARS)}.test` },
            label: 'overlong email',
        },
    ])('does not write an identity with $label', async ({ candidate }) => {
        await expect(convergeVerifiedAccountAttendanceEmail(tx, candidate)).resolves.toBe(0);
        expect(updateMany).not.toHaveBeenCalled();
    });

    it('accepts the feed-contract boundary without truncating it', async () => {
        const email = `${'a'.repeat(AMPLIFICATION_CREDIT_EMAIL_MAX_CHARS - 13)}@example.test`;
        expect(Array.from(email)).toHaveLength(AMPLIFICATION_CREDIT_EMAIL_MAX_CHARS);
        await convergeVerifiedAccountAttendanceEmail(tx, { ...identity, email });
        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { accountEmail: email, accountEmailVerified: true },
        }));
    });
});
