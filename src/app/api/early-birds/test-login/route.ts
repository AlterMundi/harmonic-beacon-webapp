import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@/lib/db';
import { earlyBirdTestAuthEnabled, earlyBirdTestLoginSecret } from '@/lib/early-birds/auth';
import { issueSyntheticMembership } from '@/lib/early-birds/membership';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import { syntheticTeamEntryAllowed } from '@/lib/early-birds/synthetic-team-entry';
import { listenerAccountCookie, localListenerAccountId } from '@/lib/listener/account-rp';
import { digestSessionToken } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';
const STAGING_ISSUER = 'https://account-staging.harmonicbeacon.com';

function notFound(): NextResponse {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
}
function digest(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
}
function authorizedSyntheticLogin(request: NextRequest): boolean {
    const expected = earlyBirdTestLoginSecret();
    if (!expected || !earlyBirdTestAuthEnabled()) return false;
    const authorization = request.headers.get('authorization');
    const presented = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    return timingSafeEqual(digest(presented), digest(expected));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled() || !syntheticTeamEntryAllowed({
        headers: request.headers, requestProtocol: request.nextUrl.protocol,
    }) || !authorizedSyntheticLogin(request)) return notFound();
    const body = await request.json().catch(() => null) as {
        email?: unknown; name?: unknown; authOnly?: unknown;
    } | null;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!/^[a-z0-9._-]{1,80}@e2e\.invalid$/.test(email) || name.length < 1 || name.length > 80) {
        return NextResponse.json({ error: 'An e2e.invalid identity and name are required.' }, { status: 400 });
    }
    const subject = `test_${createHash('sha256').update(email).digest('base64url')}`;
    const accountId = localListenerAccountId(STAGING_ISSUER, subject);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
    await prisma.$transaction(async (transaction) => {
        await transaction.earlyBirdUser.upsert({
            where: { id: accountId }, create: { id: accountId, name, email, emailVerified: true },
            update: { name },
        });
        await transaction.listenerAccountSubject.upsert({
            where: { issuer_subject: { issuer: STAGING_ISSUER, subject } },
            create: { accountId, issuer: STAGING_ISSUER, subject }, update: {},
        });
        await transaction.listenerAccountSession.create({ data: {
            tokenDigest: digestSessionToken(token), accountId, issuer: STAGING_ISSUER,
            subject, sid: `synthetic_${randomBytes(16).toString('base64url')}`,
            synthetic: true, expiresAt, lastCheckedAt: new Date(),
        } });
    });
    if (body?.authOnly !== true) await issueSyntheticMembership(accountId);
    return NextResponse.json({ ok: true, landing: '/early-birds' }, { headers: {
        'Cache-Control': 'private, no-store',
        'Set-Cookie': listenerAccountCookie(token, 8 * 60 * 60),
    } });
}

export async function GET(): Promise<NextResponse> { return notFound(); }
