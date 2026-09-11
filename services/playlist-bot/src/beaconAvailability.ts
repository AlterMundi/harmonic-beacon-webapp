export const AUDIO_TRACK_KIND = 1;

export interface BeaconTrackPublication {
  kind?: number;
  muted?: boolean;
}

export interface BeaconParticipant {
  identity: string;
  trackPublications: {
    values(): IterableIterator<BeaconTrackPublication>;
  };
}

export type BeaconAvailabilityTransition =
  | 'became-available'
  | 'became-unavailable'
  | null;

export interface BeaconAvailabilityReconciliation {
  available: boolean;
  transition: BeaconAvailabilityTransition;
}

export function participantHasAvailableAudio(
  participant: BeaconParticipant,
  beaconIdentity = 'beacon01',
): boolean {
  if (participant.identity !== beaconIdentity) return false;

  for (const publication of participant.trackPublications.values()) {
    if (publication.kind === AUDIO_TRACK_KIND && publication.muted !== true) {
      return true;
    }
  }
  return false;
}

export function hasAvailableBeaconAudio(
  participants: Iterable<BeaconParticipant>,
  beaconIdentity = 'beacon01',
): boolean {
  for (const participant of participants) {
    if (participantHasAvailableAudio(participant, beaconIdentity)) return true;
  }
  return false;
}

/**
 * Rebuild the fallback decision from the publications currently held by
 * LiveKit. Repeated or stale lifecycle events are deliberately idempotent:
 * callers start a crossfade only when `transition` is non-null.
 *
 * Reconciliation from the current snapshot is also what makes reconnect safe.
 * It does not trust the last event that happened to arrive before signaling
 * was interrupted.
 */
export function reconcileBeaconAudioAvailability(
  previous: boolean,
  participants: Iterable<BeaconParticipant>,
  beaconIdentity = 'beacon01',
): BeaconAvailabilityReconciliation {
  const available = hasAvailableBeaconAudio(participants, beaconIdentity);
  return {
    available,
    transition: available === previous
      ? null
      : available
        ? 'became-available'
        : 'became-unavailable',
  };
}
