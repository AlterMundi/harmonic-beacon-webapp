/**
 * Shared end-of-session mechanics for a `ScheduledSession`.
 *
 * Two callers end a session and they must end it the same way: the hosting
 * Provider (`PATCH /api/provider/sessions/[id]` with `action: 'end'`) and an Admin
 * using the kill switch (`POST /api/admin/sessions/[id]/terminate`). The Admin
 * path adds room termination and a mandatory audit entry on top; the recording
 * teardown and the status transition below are identical, and duplicating them
 * would let the two drift — the kill switch quietly leaking egress processes is
 * exactly the kind of drift that shows up during an incident.
 */

import { existsSync } from 'fs';
import { prisma } from '@/lib/db';
import { getEgressClient } from '@/lib/livekit-server';
import { redactErrorDetail } from '@/lib/redact';

/** Time given to an egress to flush its file before we check for it on disk. */
const EGRESS_FINALIZE_MS = 2000;

/**
 * Stop every active egress for a session and reconcile the recording rows.
 *
 * A recording whose file made it to disk is marked stopped; one whose file never
 * appeared is deleted, because a `SessionRecording` row pointing at nothing is
 * worse than no row.
 */
export async function stopActiveRecordings(sessionId: string): Promise<number> {
    const activeRecordings = await prisma.sessionRecording.findMany({
        where: { sessionId, active: true },
    });

    if (activeRecordings.length === 0) return 0;

    const egressClient = getEgressClient();
    await Promise.allSettled(
        activeRecordings.map((r) =>
            egressClient.stopEgress(r.egressId).catch((e: unknown) => {
                console.error(`Failed to stop egress ${r.egressId} on end:`, redactErrorDetail(e));
            }),
        ),
    );

    // Wait for egresses to finalize files
    await new Promise((r) => setTimeout(r, EGRESS_FINALIZE_MS));

    // Verify files and update records
    const now = new Date();
    await Promise.all(
        activeRecordings.map(async (r) => {
            const fileExists = r.filePath && existsSync(r.filePath);
            if (fileExists) {
                await prisma.sessionRecording.update({
                    where: { id: r.id },
                    data: { active: false, stoppedAt: now },
                });
            } else {
                await prisma.sessionRecording.delete({ where: { id: r.id } });
            }
        }),
    );

    return activeRecordings.length;
}

/**
 * Stop recordings and move the session to ENDED with a computed duration.
 *
 * `startedAt` comes from the caller's already-loaded row rather than a second
 * read. A session with no `startedAt` gets a duration of 0 instead of a
 * nonsensical one measured from the epoch.
 */
export async function endLiveSession(
    sessionId: string,
    startedAt: Date | null,
): Promise<{ session: Awaited<ReturnType<typeof prisma.scheduledSession.update>>; recordingsStopped: number }> {
    const recordingsStopped = await stopActiveRecordings(sessionId);

    const now = new Date();
    const durationSeconds = startedAt
        ? Math.floor((now.getTime() - startedAt.getTime()) / 1000)
        : 0;

    const session = await prisma.scheduledSession.update({
        where: { id: sessionId },
        data: {
            status: 'ENDED',
            endedAt: now,
            durationSeconds,
        },
    });

    return { session, recordingsStopped };
}
