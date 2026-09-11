import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDIO_TRACK_KIND,
  hasAvailableBeaconAudio,
  participantHasAvailableAudio,
  reconcileBeaconAudioAvailability,
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

  it('emits each availability transition exactly once across duplicate lifecycle events', () => {
    const publication = { kind: AUDIO_TRACK_KIND, muted: false };
    const beacon = participant('beacon01', [publication]);

    const published = reconcileBeaconAudioAvailability(false, [beacon]);
    assert.deepEqual(published, {
      available: true,
      transition: 'became-available',
    });

    // TrackPublished plus TrackUnmuted can describe the same current state.
    // Only the first snapshot change may trigger the fade-out.
    assert.deepEqual(
      reconcileBeaconAudioAvailability(published.available, [beacon]),
      { available: true, transition: null },
    );

    publication.muted = true;
    const muted = reconcileBeaconAudioAvailability(true, [beacon]);
    assert.deepEqual(muted, {
      available: false,
      transition: 'became-unavailable',
    });

    // A later stale TrackUnpublished event still describes "unavailable" and
    // must not trigger a second fade-in.
    assert.deepEqual(
      reconcileBeaconAudioAvailability(muted.available, []),
      { available: false, transition: null },
    );
  });

  it('does not fade in for an obsolete unpublish while another live audio publication remains', () => {
    const first = { kind: AUDIO_TRACK_KIND, muted: false };
    const second = { kind: AUDIO_TRACK_KIND, muted: false };
    const beacon = participant('beacon01', [first, second]);

    assert.deepEqual(
      reconcileBeaconAudioAvailability(true, [beacon]),
      { available: true, transition: null },
    );

    first.muted = true;
    assert.deepEqual(
      reconcileBeaconAudioAvailability(true, [beacon]),
      { available: true, transition: null },
    );
  });

  it('does not fade in for a stale disconnect after beacon01 was replaced', () => {
    const replacement = participant('beacon01', [
      { kind: AUDIO_TRACK_KIND, muted: false },
    ]);

    // ParticipantDisconnected for the prior identity can arrive after the
    // room snapshot already contains the replacement. Reconciliation must
    // trust that snapshot, not the stale event payload.
    assert.deepEqual(
      reconcileBeaconAudioAvailability(true, [replacement]),
      { available: true, transition: null },
    );
  });

  it('reconstructs both sides of the decision from the current snapshot after reconnect', () => {
    const liveBeacon = participant('beacon01', [
      { kind: AUDIO_TRACK_KIND, muted: false },
    ]);
    const silentBeacon = participant('beacon01');

    assert.deepEqual(
      reconcileBeaconAudioAvailability(false, [liveBeacon]),
      { available: true, transition: 'became-available' },
    );
    assert.deepEqual(
      reconcileBeaconAudioAvailability(true, [silentBeacon]),
      { available: false, transition: 'became-unavailable' },
    );
  });
});
