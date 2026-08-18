import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { currentAccountSession } from '@/lib/account/auth';
import {
    accountActionTokenCanProceed,
    consumeAccountActionTokenWith,
} from '@/lib/account/action-tokens';
import { accountEnvironment, accountRateSecret } from '@/lib/account/config';
import {
    queueAccountActionMail,
    queueAccountActionMailInTransaction,
} from '@/lib/account/mail-outbox';
import { consumeAccountRateLimit } from '@/lib/account/rate-limit';
import { hashAccountPassword, verifyAccountPassword } from '@/lib/session-auth';
import { revokeAllAccountSessions } from '@/lib/account/revocation';

const GENERIC_FLOOR_MS = 300;

async function invalidateAccountActions(
    transaction: Prisma.TransactionClient,
    accountId: string,
    now = new Date(),
) {
    await transaction.beaconAccountActionToken.updateMany({
        where: { accountId, consumedAt: null }, data: { consumedAt: now },
    });
    await transaction.beaconAccountMailOutbox.deleteMany({ where: { accountId } });
}

function validEmail(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function requestLocale(request: Request): 'es' | 'en' {
    const explicit = request.headers.get('x-hb-locale');
    if (explicit === 'es' || explicit === 'en') return explicit;
    return request.headers.get('accept-language')?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

async function genericFloor(startedAt: number) {
    const remaining = GENERIC_FLOOR_MS - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

export async function requestPasswordReset(request: Request, emailValue: unknown): Promise<void> {
    const startedAt = Date.now();
    try {
        if (!validEmail(emailValue)) return;
        const email = emailValue.trim().toLowerCase();
        const secret = accountRateSecret();
        if (!secret || !await consumeAccountRateLimit({ request, email, purpose: 'reset', secret })) return;
        const user = await prisma.earlyBirdUser.findUnique({
            where: { email },
            select: { id: true, email: true, emailVerified: true, identities: {
                where: { providerId: 'credential' }, select: { id: true }, take: 1,
            } },
        });
        if (!user?.emailVerified || user.identities.length === 0) return;
        await queueAccountActionMail({
            accountId: user.id, recipient: user.email, purpose: 'reset_password',
            locale: requestLocale(request),
        });
    } catch {
        // Enumeration-neutral by contract. Readiness exposes infrastructure state.
    } finally {
        await genericFloor(startedAt);
    }
}

export async function completePasswordReset(token: string, password: string): Promise<boolean> {
    if (!await accountActionTokenCanProceed({ token, purpose: 'reset_password' })) return false;
    let passwordDigest: string;
    try { passwordDigest = await hashAccountPassword(password); } catch { return false; }
    const completed = await consumeAccountActionTokenWith({ token, purpose: 'reset_password' }, async (transaction, action) => {
        await transaction.$queryRaw`SELECT "id" FROM "early_bird_users" WHERE "id" = ${action.accountId} FOR UPDATE`;
        const credential = await transaction.earlyBirdIdentity.updateMany({
            where: { userId: action.accountId, providerId: 'credential' },
            data: { password: passwordDigest },
        });
        if (credential.count !== 1) throw new Error('Credential authority is ambiguous');
        await transaction.earlyBirdUser.update({
            where: { id: action.accountId }, data: { securityRevision: { increment: 1 } },
        });
        await invalidateAccountActions(transaction, action.accountId);
        await revokeAllAccountSessions(transaction, action.accountId);
        return true;
    });
    return completed === true;
}

export async function verifyAccountEmail(token: string): Promise<boolean> {
    const completed = await consumeAccountActionTokenWith({ token, purpose: 'verify_email' }, async (transaction, action) => {
        await transaction.$queryRaw`SELECT "id" FROM "early_bird_users" WHERE "id" = ${action.accountId} FOR UPDATE`;
        await transaction.earlyBirdUser.update({
            where: { id: action.accountId }, data: { emailVerified: true },
        });
        return true;
    });
    return completed === true;
}

export async function requestEmailChange(request: Request, newEmailValue: unknown, password: unknown): Promise<boolean> {
    if (!validEmail(newEmailValue) || typeof password !== 'string') return false;
    const session = await currentAccountSession(request.headers);
    if (!session) return false;
    const newEmail = newEmailValue.trim().toLowerCase();
    const secret = accountRateSecret();
    if (!secret || !await consumeAccountRateLimit({
        request, email: newEmail, purpose: 'change-email', secret, maxPerEmail: 3, maxPerOrigin: 6,
    })) return false;
    try {
        return await prisma.$transaction(async (transaction) => {
            await transaction.$queryRaw`SELECT "id" FROM "early_bird_users" WHERE "id" = ${session.user.id} FOR UPDATE`;
            await transaction.$queryRaw`SELECT "id" FROM "early_bird_auth_sessions" WHERE "id" = ${session.session.id} FOR UPDATE`;
            const authority = await transaction.earlyBirdAuthSession.findUnique({
                where: { id: session.session.id },
                select: {
                    userId: true, securityRevision: true, authorityEnvironment: true,
                    user: { select: { securityRevision: true } },
                },
            });
            if (!authority || authority.userId !== session.user.id ||
                authority.authorityEnvironment !== accountEnvironment() ||
                authority.securityRevision !== authority.user.securityRevision) return false;
            const credential = await transaction.earlyBirdIdentity.findFirst({
                where: { userId: session.user.id, providerId: 'credential' },
                select: { password: true },
            });
            if (!credential?.password || !await verifyAccountPassword({
                hash: credential.password, password,
            })) return false;
            if (await transaction.earlyBirdUser.count({
                where: { email: newEmail, id: { not: session.user.id } },
            })) return false;
            await queueAccountActionMailInTransaction(transaction, {
                accountId: session.user.id, recipient: newEmail,
                purpose: 'change_email', targetEmail: newEmail,
                locale: requestLocale(request),
            });
            return true;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch { return false; }
}

export async function confirmEmailChange(token: string): Promise<boolean> {
    try {
        const completed = await consumeAccountActionTokenWith({ token, purpose: 'change_email' }, async (transaction, action) => {
            if (!action.targetEmail) throw new Error('Email change target missing');
            await transaction.$queryRaw`SELECT "id" FROM "early_bird_users" WHERE "id" = ${action.accountId} FOR UPDATE`;
            await transaction.earlyBirdUser.update({
                where: { id: action.accountId },
                data: {
                    email: action.targetEmail,
                    emailVerified: true,
                    securityRevision: { increment: 1 },
                },
            });
            await invalidateAccountActions(transaction, action.accountId);
            await revokeAllAccountSessions(transaction, action.accountId);
            return true;
        });
        return completed === true;
    } catch { return false; }
}

export async function changeAccountPassword(request: Request, currentPassword: unknown, newPassword: unknown): Promise<boolean> {
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') return false;
    const session = await currentAccountSession(request.headers);
    if (!session) return false;
    const secret = accountRateSecret();
    if (!secret || !await consumeAccountRateLimit({
        request,
        email: session.user.id,
        purpose: 'password-change',
        secret,
        maxPerEmail: 5,
        maxPerOrigin: 10,
        maxGlobal: 500,
    })) return false;
    let passwordDigest: string;
    try { passwordDigest = await hashAccountPassword(newPassword); } catch { return false; }
    return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "early_bird_users" WHERE "id" = ${session.user.id} FOR UPDATE`;
        await transaction.$queryRaw`SELECT "id" FROM "early_bird_auth_sessions" WHERE "id" = ${session.session.id} FOR UPDATE`;
        const authority = await transaction.earlyBirdAuthSession.findUnique({
            where: { id: session.session.id },
            select: {
                userId: true, securityRevision: true, authorityEnvironment: true,
                user: { select: { securityRevision: true } },
            },
        });
        if (!authority || authority.userId !== session.user.id ||
            authority.authorityEnvironment !== accountEnvironment() ||
            authority.securityRevision !== authority.user.securityRevision) return false;
        const credential = await transaction.earlyBirdIdentity.findFirst({
            where: { userId: session.user.id, providerId: 'credential' },
            select: { id: true, password: true },
        });
        if (!credential?.password || !await verifyAccountPassword({
            hash: credential.password, password: currentPassword,
        })) return false;
        const credentialUpdate = await transaction.earlyBirdIdentity.updateMany({
            where: { id: credential.id, userId: session.user.id, providerId: 'credential', password: credential.password },
            data: { password: passwordDigest },
        });
        if (credentialUpdate.count !== 1) throw new Error('Credential authority changed during password update');
        await transaction.earlyBirdUser.update({
            where: { id: session.user.id }, data: { securityRevision: { increment: 1 } },
        });
        await invalidateAccountActions(transaction, session.user.id);
        await revokeAllAccountSessions(transaction, session.user.id);
        return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function completeEmailAction(token: string): Promise<boolean> {
    if (await verifyAccountEmail(token)) return true;
    return confirmEmailChange(token);
}
