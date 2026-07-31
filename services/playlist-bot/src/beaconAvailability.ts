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
