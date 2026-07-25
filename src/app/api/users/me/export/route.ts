import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/**
 * Bumped whenever the shape below changes in a way a consumer would notice.
 * BUSINESS_RULES.md 9.1 promises the export format is "documented and stable
 * across versions"; a version field is what makes that promise checkable
 * instead of aspirational.
 */
const FORMAT_VERSION = 1;

/**
 * GET /api/users/me/export
 * Returns everything we hold about the caller as a downloadable JSON file.
 * Implements the Access and Portability halves of BUSINESS_RULES.md 9.1.
 */
export async function GET() {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    try {
        const user = await prisma.user.findUnique({
            where: { zitadelId: session.user.id },
            select: {
                id: true,
                email: true,
                name: true,
                avatarUrl: true,
                role: true,
                createdAt: true,
            },
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const isProvider = user.role === 'PROVIDER' || user.role === 'ADMIN';

        const [listeningSessions, favorites, participations, meditations, scheduledSessions] =
            await Promise.all([
                prisma.listeningSession.findMany({
                    where: { userId: user.id },
                    include: { meditation: { select: { title: true } } },
                    orderBy: { startedAt: 'desc' },
                }),
                prisma.favorite.findMany({
                    where: { userId: user.id },
                    include: { meditation: { select: { title: true } } },
                    orderBy: { createdAt: 'desc' },
                }),
                prisma.sessionParticipant.findMany({
                    where: { userId: user.id },
                    include: { session: { select: { title: true } } },
                    orderBy: { joinedAt: 'desc' },
                }),
                isProvider
                    ? prisma.meditation.findMany({
                          where: { providerId: user.id },
                          orderBy: { createdAt: 'desc' },
                      })
                    : Promise.resolve([]),
                isProvider
                    ? prisma.scheduledSession.findMany({
                          where: { providerId: user.id },
                          orderBy: { createdAt: 'desc' },
                      })
                    : Promise.resolve([]),
            ]);

        const payload = {
            formatVersion: FORMAT_VERSION,
            exportedAt: new Date().toISOString(),
            notes: {
                audioFiles:
                    'Audio files are not included in this export. BUSINESS_RULES.md 9.1 states the export covers structured records only; request audio separately.',
                tombstones:
                    'A null meditation or scheduledSession title means the referenced content was removed after the session was recorded. The session row is retained for history integrity (BUSINESS_RULES.md 9.2).',
                unbuiltSurfaces:
                    'researchParticipations and patronage are named in BUSINESS_RULES.md 9.1 but neither surface exists in the platform yet, so there is nothing to export. The keys are present and empty rather than omitted so that a future export is diff-comparable against this one.',
            },
            profile: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatarUrl: user.avatarUrl,
                role: user.role,
                createdAt: user.createdAt,
            },
            listeningSessions: listeningSessions.map((s) => ({
                id: s.id,
                type: s.type,
                meditationId: s.meditationId,
                meditationTitle: s.meditation?.title ?? null,
                scheduledSessionId: s.scheduledSessionId,
                durationSeconds: s.durationSeconds,
                completed: s.completed,
                startedAt: s.startedAt,
                endedAt: s.endedAt,
            })),
            favorites: favorites.map((f) => ({
                meditationId: f.meditationId,
                meditationTitle: f.meditation?.title ?? null,
                createdAt: f.createdAt,
            })),
            sessionParticipations: participations.map((p) => ({
                id: p.id,
                sessionId: p.sessionId,
                sessionTitle: p.session?.title ?? null,
                joinedAt: p.joinedAt,
                leftAt: p.leftAt,
                durationSeconds: p.durationSeconds,
            })),
            authoredMeditations: meditations.map((m) => ({
                id: m.id,
                title: m.title,
                description: m.description,
                durationSeconds: m.durationSeconds,
                status: m.status,
                isPublished: m.isPublished,
                isFeatured: m.isFeatured,
                isHidden: m.isHidden,
                createdAt: m.createdAt,
                updatedAt: m.updatedAt,
            })),
            hostedSessions: scheduledSessions.map((s) => ({
                id: s.id,
                title: s.title,
                description: s.description,
                status: s.status,
                scheduledAt: s.scheduledAt,
                startedAt: s.startedAt,
                endedAt: s.endedAt,
                durationSeconds: s.durationSeconds,
                createdAt: s.createdAt,
            })),
            researchParticipations: [],
            patronage: [],
        };

        const date = payload.exportedAt.slice(0, 10);

        return NextResponse.json(payload, {
            headers: {
                'Content-Disposition': `attachment; filename="harmonic-beacon-export-${date}.json"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('Export error:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to export account data' }, { status: 500 });
    }
}
