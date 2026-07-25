import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/me
 * Returns user profile + stats
 */
export async function GET() {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            role: true,
        },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [totalSessions, totalMinutesResult, favoritesCount] = await Promise.all([
        prisma.listeningSession.count({
            where: { userId: user.id },
        }),
        prisma.listeningSession.aggregate({
            where: { userId: user.id },
            _sum: { durationSeconds: true },
        }),
        prisma.favorite.count({
            where: { userId: user.id },
        }),
    ]);

    const totalMinutes = Math.floor((totalMinutesResult._sum.durationSeconds || 0) / 60);

    return NextResponse.json({
        user: {
            name: user.name,
            email: user.email,
            avatarUrl: user.avatarUrl,
            role: user.role,
        },
        stats: {
            totalSessions,
            totalMinutes,
            favoritesCount,
        },
    });
}

/**
 * DELETE /api/users/me
 * Deletes the caller's own account. Implements the Deletion half of
 * BUSINESS_RULES.md 9.1.
 *
 * This anonymises in place rather than dropping the row. `Meditation.provider`
 * and `ScheduledSession.provider` declare no `onDelete`, so they restrict:
 * removing a User who authored either fails on a foreign key. Keeping the row
 * and overwriting every identifying column on it purges the personal data
 * without breaking the tombstone behaviour BUSINESS_RULES.md 9.2 already
 * commits to for Listener history.
 */
export async function DELETE() {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    try {
        const user = await prisma.user.findUnique({
            where: { zitadelId: session.user.id },
            select: { id: true },
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const [meditationCount, scheduledSessionCount] = await Promise.all([
            prisma.meditation.count({ where: { providerId: user.id } }),
            prisma.scheduledSession.count({ where: { providerId: user.id } }),
        ]);
        const authoredContentCount = meditationCount + scheduledSessionCount;

        // Both placeholders land in `@unique` columns, so they are derived from
        // the user id. A constant would collide the moment a second account is
        // deleted and the request would fail on a unique violation.
        const placeholderEmail = `deleted-${user.id}@deleted.invalid`;
        const placeholderZitadelId = `deleted-${user.id}`;

        // Stored audio: nothing to purge *here*, and that is a design conclusion
        // rather than an omission. The key layout in CLOUD_MIGRATION_PLAN.md 4.1
        // (branch `feat/cloud-migration`) keys every object by content, never by
        // user:
        //
        //   uploads/{meditationId}/{filename}       PENDING / REJECTED
        //   meditations/{meditationId}/{filename}   APPROVED
        //   recordings/{sessionId}/{trackId}.ogg    egress
        //   beacon-records/{yyyy-mm-dd}/{file}.ogg  playlist source
        //
        // A Listener owns no objects under any of those prefixes. A Provider's
        // objects hang off meditations and sessions this endpoint deliberately
        // retains (see the takedown TODO below), so purging them here would
        // delete content we just promised to keep serving. The audio-purge
        // obligation in BUSINESS_RULES.md 9.1 is therefore discharged by the
        // takedown path, not by account deletion — and the key layout needs no
        // user-keyed prefix added to support it, because both meditation keys
        // are derivable from the Meditation row.
        //
        // TODO(storage): when the driver lands, takedown deletes
        // `uploads/{id}/*` and `meditations/{id}/*` for each meditation and
        // `recordings/{sessionId}/*` for each hosted session. Two ordering
        // traps from 4.4: presigned GETs already issued stay valid until their
        // TTL expires, so a purge is not effective until the longest outstanding
        // TTL has passed; and the object delete must follow the DB commit, never
        // precede it, or a failed transaction leaves a row pointing at a key
        // that is gone.

        await prisma.$transaction([
            prisma.favorite.deleteMany({ where: { userId: user.id } }),
            prisma.listeningSession.deleteMany({ where: { userId: user.id } }),
            prisma.sessionParticipant.deleteMany({ where: { userId: user.id } }),
            prisma.user.update({
                where: { id: user.id },
                data: {
                    email: placeholderEmail,
                    name: null,
                    avatarUrl: null,
                    zitadelId: placeholderZitadelId,
                    role: 'LISTENER',
                    deletedAt: new Date(),
                },
            }),
        ]);

        // TODO(takedown): authored content stays published under an anonymised
        // provider record because there is no provider takedown path yet. When
        // one exists, this endpoint should offer or require it before deleting a
        // Provider account. Tracked as "Build provider self-takedown".
        const retained = [
            'Your account record is retained as an anonymised row. Published content and other listeners\' session history reference it, and removing it would break those references. It no longer holds your email, name, avatar or identity-provider subject.',
            'Stored audio is not purged. No object-storage driver exists yet, so audio still sits on the host filesystem and deleting it is not something this endpoint can do. This is a known gap against BUSINESS_RULES.md 9.1.',
        ];

        if (authoredContentCount > 0) {
            retained.push(
                'Content you authored remains published under the anonymised provider record. Removing it needs the provider takedown path, which does not exist yet; contact an administrator.',
            );
        }

        return NextResponse.json({
            deleted: true,
            deletedData: [
                'profile identifiers (email, name, avatar, identity-provider subject)',
                'favourites',
                'listening history',
                'session participation records',
            ],
            retained,
            authoredContentCount,
        });
    } catch (error) {
        console.error('Account deletion error:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
    }
}
