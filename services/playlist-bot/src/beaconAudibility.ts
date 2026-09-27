/** Only short-lived level metadata is retained; audio is never recorded. */
export class BeaconAudibility {
  private readonly lastSound = new Map<string, number>();
  // Roughly -60 dBFS: reject digital silence while retaining quiet music.
  static readonly minimumRms = 32;
  // Bridge short pauses; sustained silence or missing media restores the bed.
  static readonly silenceGraceMs = 3000;

  observe(trackId: string, samples: Int16Array, now = performance.now()): void {
    if (!samples.length) return;
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    if (Math.sqrt(energy / samples.length) >= BeaconAudibility.minimumRms) {
      this.lastSound.set(trackId, now);
    }
  }

  audible(trackIds: Iterable<string>, now = performance.now()): boolean {
    for (const id of trackIds) {
      const last = this.lastSound.get(id);
      if (last !== undefined && now - last < BeaconAudibility.silenceGraceMs) return true;
    }
    return false;
  }

  forget(trackId: string): void { this.lastSound.delete(trackId); }
  clear(): void { this.lastSound.clear(); }
}
