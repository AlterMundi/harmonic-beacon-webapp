/**
 * Shared end-of-session mechanics for a `ScheduledSession`.
 *
 * Two callers end a session and they must end it the same way: the hosting
 * Provider (`PATCH /api/provider/sessions/[id]` with `action: 'end'`) and an Admin
 * using the kill switch (`POST /api/admin/sessions/[id]/terminate`). The Admin
 * path adds a mandatory audit entry on top; everything else — stopping the
 * recordings, closing the room, moving the row to ENDED — is identical, and
 * duplicating it would let the two drift.
 *
 * Room termination lives here rather than in the kill switch because it did drift.
 * Only the Admin path closed the room, so a Provider ending their own session left
 * every listener connected to a room with no publisher: silence, no disconnect
 * event, nothing on screen to explain it. That is the ordinary path, taken far
 * more often than the kill switch, and it was the one that stranded people.
 */

import { existsSync } from 'fs';
import { prisma } from '@/lib/db';
import { getEgressClient, getRoomService } from '@/lib/livekit-server';
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
 * Stop recordings, move the session to ENDED, and close the room.
 *
 * `startedAt` comes from the caller's already-loaded row rather than a second
 * read. A session with no `startedAt` gets a duration of 0 instead of a
 * nonsensical one measured from the epoch.
 *
 * `roomName` may be omitted, in which case the room is left standing — but every
 * caller should pass it. Without it the session ends in the database while the
 * participants stay connected to a room nobody is publishing to.
 */
export async function endLiveSession(
    sessionId: string,
    startedAt: Date | null,
    roomName?: string,
): Promise<{
    session: Awaited<ReturnType<typeof prisma.scheduledSession.update>>;
    recordingsStopped: number;
    roomDeleted: boolean;
}> {
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

    // Deliberately after the DB write. If this throws, the session is already
    // ENDED and cannot be restarted from the UI, which is the safer half-state: a
    // room left standing with no publishable session is recoverable, whereas a
    // live room whose row still says LIVE is indistinguishable from a working
    // session. Never fatal — the session has ended either way, and reporting a
    // failure to the caller would suggest it had not.
    let roomDeleted = false;
    if (roomName) {
        try {
            await getRoomService().deleteRoom(roomName);
            roomDeleted = true;
        } catch (error) {
            console.error(
                `Failed to delete LiveKit room ${roomName} on end:`,
                redactErrorDetail(error),
            );
        }
    }

    return { session, recordingsStopped, roomDeleted };
}
