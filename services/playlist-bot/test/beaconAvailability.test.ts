import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDIO_TRACK_KIND,
  hasAvailableBeaconAudio,
  participantHasAvailableAudio,
  type BeaconTrackPublication,
} from '../src/beaconAvailability.js';

function participant(
  identity: string,
  publications: BeaconTrackPublication[] = [],
) {
  return {
    identity,
    trackPublications: new Map(publications.map((publication, index) => [String(index), publication])),
  };
}

describe('Beacon audio availability', () => {
  it('keeps fallback active when beacon01 is present without a track', () => {
    assert.equal(participantHasAvailableAudio(participant('beacon01')), false);
  });

  it('requires an unmuted audio publication', () => {
    assert.equal(participantHasAvailableAudio(participant('beacon01', [
      { kind: 2, muted: false },
      { kind: AUDIO_TRACK_KIND, muted: true },
    ])), false);

    assert.equal(participantHasAvailableAudio(participant('beacon01', [
      { kind: AUDIO_TRACK_KIND, muted: false },
    ])), true);
  });

  it('ignores audio from identities other than beacon01', () => {
    assert.equal(hasAvailableBeaconAudio([
      participant('facilitator', [{ kind: AUDIO_TRACK_KIND, muted: false }]),
      participant('beacon01'),
    ]), false);
  });

  it('returns to fallback when the live publication becomes muted', () => {
    const publication = { kind: AUDIO_TRACK_KIND, muted: false };
    const beacon = participant('beacon01', [publication]);
    assert.equal(hasAvailableBeaconAudio([beacon]), true);

    publication.muted = true;
    assert.equal(hasAvailableBeaconAudio([beacon]), false);
  });
});
