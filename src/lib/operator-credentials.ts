import { prisma } from '@/lib/db';
import { issueSessionToken, digestSessionToken, sessionTokenMatchesDigest } from '@/lib/session-auth';

/** Locally issued machine credentials are never Beacon Account identities. */
export const OPERATOR_ISSUER = 'urn:harmonic-beacon:operator:v1';
export const OPERATOR_SESSION = 'machine-bearer-v1';
export const OPERATOR_PASSWORD = 'operator-only:v1';
export const OPERATOR_TOKEN_PREFIX = 'hbop_v1_';
export const MAX_OPERATOR_TTL_HOURS = 30 * 24;

export async function resolveOperatorAuthorization(authorization: string, now = new Date()) {
    const match = /^Bearer (hbop_v1_[A-Za-z0-9_-]{43})$/i.exec(authorization);
    if (!match || !match[1].startsWith(OPERATOR_TOKEN_PREFIX)) return null;
    const token = match[1];
    const session = await prisma.webSession.findUnique({
        where: { tokenDigest: digestSessionToken(token) },
        include: { staffUser: true },
    });
    if (!session || !session.staffUser ||
        session.accountIssuer !== OPERATOR_ISSUER ||
        session.accountSessionId !== OPERATOR_SESSION ||
        session.accountSubject !== session.staffUser.id ||
        session.staffUserId !== session.staffUser.id ||
        session.ticketEntitlementId !== null ||
        session.staffUser.passwordDigest !== OPERATOR_PASSWORD ||
        session.staffUser.disabledAt !== null || session.revokedAt !== null ||
        session.expiresAt.getTime() <= now.getTime() ||
        session.createdAt.getTime() > now.getTime() ||
        session.expiresAt.getTime() - session.createdAt.getTime() > MAX_OPERATOR_TTL_HOURS * 3_600_000 ||
        !sessionTokenMatchesDigest(token, session.tokenDigest)) return null;
    const binding = await prisma.staffAccountBinding.findUnique({ where: { staffUserId: session.staffUser.id } });
    if (binding) return null;
    return {
        principal: { kind: 'staff' as const, webSessionId: session.id,
            userId: session.staffUser.id, role: session.staffUser.role },
        staff: { id: session.staffUser.id, email: session.staffUser.email,
            name: session.staffUser.name, role: session.staffUser.role },
    };
}

/** Root CLI only. Never attach a machine credential to an existing human user. */
export async function provisionOperator(email: string, name: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name.trim() || name.length > 80) {
        throw new Error('Valid operator email and name required');
    }
    return prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) {
            const binding = await tx.staffAccountBinding.findUnique({ where: { staffUserId: existing.id } });
            if (existing.passwordDigest !== OPERATOR_PASSWORD || binding || existing.disabledAt || existing.role !== 'ADMIN') {
                throw new Error('Existing identity is not an enabled machine administrator');
            }
            return existing;
        }
        const user = await tx.user.create({ data: {
            email, name: name.trim(), role: 'ADMIN', passwordDigest: OPERATOR_PASSWORD,
        } });
        await tx.auditLog.create({ data: { actorUserId: user.id, actorRole: user.role,
            action: 'operator.provisioned', targetType: 'User', targetId: user.id,
            reason: 'Human-authorized local machine operator provisioning' } });
        return user;
    });
}

export async function issueOperatorCredential(userId: string, ttlHours: number, now = new Date()) {
    if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > MAX_OPERATOR_TTL_HOURS) {
        throw new Error('Operator credential lifetime must be 1–720 hours');
    }
    const token = OPERATOR_TOKEN_PREFIX + issueSessionToken().cookieValue;
    const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);
    const session = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const binding = await tx.staffAccountBinding.findUnique({ where: { staffUserId: userId } });
        if (user.passwordDigest !== OPERATOR_PASSWORD || user.disabledAt || binding) {
            throw new Error('An enabled machine operator is required');
        }
        const created = await tx.webSession.create({ data: {
            tokenDigest: digestSessionToken(token), staffUserId: userId,
            accountIssuer: OPERATOR_ISSUER, accountSubject: userId,
            accountSessionId: OPERATOR_SESSION, accountValidatedAt: now, expiresAt, createdAt: now,
        } });
        await tx.auditLog.create({ data: { actorUserId: userId, actorRole: user.role,
            action: 'operator.credential.issued', targetType: 'WebSession', targetId: created.id,
            reason: 'Human-authorized machine credential', metadata: { expiresAt: expiresAt.toISOString() } } });
        return created;
    });
    return { token, sessionId: session.id, expiresAt };
}

export async function revokeOperatorCredential(sessionId: string) {
    return prisma.$transaction(async (tx) => {
        const session = await tx.webSession.findUniqueOrThrow({ where: { id: sessionId }, include: { staffUser: true } });
        if (session.accountIssuer !== OPERATOR_ISSUER || !session.staffUser ||
            session.accountSubject !== session.staffUser.id || session.accountSessionId !== OPERATOR_SESSION) {
            throw new Error('Not an operator credential');
        }
        await tx.webSession.update({ where: { id: sessionId }, data: {
            revokedAt: new Date(), revocationReason: 'operator_credential_revoked',
        } });
        await tx.auditLog.create({ data: { actorUserId: session.staffUser.id, actorRole: session.staffUser.role,
            action: 'operator.credential.revoked', targetType: 'WebSession', targetId: sessionId,
            reason: 'Root operator credential revocation' } });
    });
}
