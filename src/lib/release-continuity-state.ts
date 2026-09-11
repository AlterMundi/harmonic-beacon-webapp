export type ReleaseContinuityState = {
  liveSessionIds: string[];
  rooms: Array<{
    name: string;
    participants: Array<{ identity: string; hasPublishedAudio: boolean }>;
  }>;
};

const PASSIVE_BED_ROOM = 'beacon';
const PASSIVE_BED_IDENTITY = 'playlist-bot';

export function assertReleaseContinuity(state: ReleaseContinuityState): { safe: true } {
  if (state.liveSessionIds.length > 0) {
    throw new Error('release blocked while a LIVE session exists');
  }

  for (const room of state.rooms) {
    for (const participant of room.participants) {
      const passiveBedBot = room.name === PASSIVE_BED_ROOM && participant.identity === PASSIVE_BED_IDENTITY;
      if (participant.hasPublishedAudio && !passiveBedBot) {
        throw new Error('release blocked by active room audio continuity');
      }
      if (!passiveBedBot) {
        throw new Error('release blocked by an active room participant');
      }
    }
  }

  return { safe: true };
}
