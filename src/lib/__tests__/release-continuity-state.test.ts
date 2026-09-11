import { describe, expect, it } from 'vitest';

import { assertReleaseContinuity } from '../release-continuity-state';

describe('release continuity guard', () => {
  it('permits an idle stack and the isolated bed bot only', () => {
    expect(assertReleaseContinuity({ liveSessionIds: [], rooms: [] })).toEqual({ safe: true });
    expect(assertReleaseContinuity({
      liveSessionIds: [],
      rooms: [{ name: 'beacon', participants: [{ identity: 'playlist-bot', hasPublishedAudio: true }] }],
    })).toEqual({ safe: true });
  });

  it('fails closed for DB-live sessions, active rooms, or user audio', () => {
    expect(() => assertReleaseContinuity({ liveSessionIds: ['opaque-session'], rooms: [] })).toThrow(/LIVE session/);
    expect(() => assertReleaseContinuity({
      liveSessionIds: [],
      rooms: [{ name: 'stage-room', participants: [{ identity: 'opaque-user', hasPublishedAudio: false }] }],
    })).toThrow(/active room/);
    expect(() => assertReleaseContinuity({
      liveSessionIds: [],
      rooms: [{ name: 'beacon', participants: [{ identity: 'opaque-user', hasPublishedAudio: true }] }],
    })).toThrow(/audio continuity/);
  });
});
