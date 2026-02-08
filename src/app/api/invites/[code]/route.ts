import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/invites/[code]
 * Validate an invite code and return session info.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ code: string }> },
) {
    const [, errorResponse] = await requireAuth();
    if (errorResponse) return errorResponse;

    const { code } = await params;

    const invite = await prisma.sessionInvite.findUnique({
        where: { code },
        include: {
            session: {
                include: {
                    provider: { select: { name: true } },
                    _count: { select: { participants: true } },
                },
            },
        },
    });

    if (!invite) {
        return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
    }

    const isExpired = invite.expiresAt && invite.expiresAt < new Date();
    const isUsedUp = invite.maxUses > 0 && invite.usedCount >= invite.maxUses;

    if (isExpired || isUsedUp) {
        return NextResponse.json({ error: 'Invite is no longer valid' }, { status: 410 });
    }

    if (invite.session.status === 'ENDED' || invite.session.status === 'CANCELLED') {
        return NextResponse.json({ error: 'Session has ended' }, { status: 410 });
    }

    return NextResponse.json({
        invite: {
            code: invite.code,
            sessionId: invite.sessionId,
        },
        session: {
            id: invite.session.id,
            title: invite.session.title,
            description: invite.session.description,
            status: invite.session.status,
            scheduledAt: invite.session.scheduledAt?.toISOString() ?? null,
            providerName: invite.session.provider.name,
            participantCount: invite.session._count.participants,
        },
    });
}
