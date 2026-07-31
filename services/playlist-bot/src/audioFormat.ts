export const SAMPLE_RATE = 48_000;
export const NUM_CHANNELS = 2;
export const FRAME_DURATION_MS = 20;
export const SAMPLES_PER_CHANNEL = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000;
export const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * Int16Array.BYTES_PER_ELEMENT;
// LiveKit/Opus maximum-quality stereo profile. Changes to these values require
// explicit product-owner approval: audio fidelity is a core product contract.
export const MUSIC_BITRATE = 510_000n;
export const MUSIC_DTX = false;
export const MUSIC_RED = false;

/** Decode to interleaved stereo PCM without collapsing the source image. */
export function decoderArgs(filePath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', filePath,
    '-f', 's16le',
    '-ar', String(SAMPLE_RATE),
    '-ac', String(NUM_CHANNELS),
    'pipe:1',
  ];
}
