/**
 * Shared end-of-session mechanics for a `ScheduledSession`.
 *
 * Two callers end a session and they must end it the same way: the hosting
 * Provider (`PATCH /api/provider/sessions/[id]` with `action: 'end'`) and an Admin
 * using the kill switch (`POST /api/admin/sessions/[id]/terminate`). The Admin
 * path adds a mandatory audit entry on top; everything else — closing the room
 * and moving the row to ENDED — is identical, and
 * duplicating it would let the two drift.
 *
 * Room termination lives here rather than in the kill switch because it did drift.
 * Only the Admin path closed the room, so a Provider ending their own session left
 * every listener connected to a room with no publisher: silence, no disconnect
 * event, nothing on screen to explain it. That is the ordinary path, taken far
 * more often than the kill switch, and it was the one that stranded people.
 */

import { prisma } from '@/lib/db';
import { getRoomService } from '@/lib/livekit-server';
import { redactErrorDetail } from '@/lib/redact';

/**
 * Move the session to ENDED and close the room. Recording/egress is disabled
 * for the weekend build, so this path never contacts an egress service.
 *
 * `roomName` may be omitted, in which case the room is left standing — but every
 * caller should pass it. Without it the session ends in the database while the
 * participants stay connected to a room nobody is publishing to.
 */
export async function endLiveSession(
    sessionId: string,
    _startedAt: Date | null,
    roomName?: string,
): Promise<{
    session: Awaited<ReturnType<typeof prisma.scheduledSession.update>>;
    recordingsStopped: number;
    roomDeleted: boolean;
}> {
    const now = new Date();

    const session = await prisma.scheduledSession.update({
        where: { id: sessionId },
        data: {
            status: 'ENDED',
            endedAt: now,
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

    return { session, recordingsStopped: 0, roomDeleted };
}
