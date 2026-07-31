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

/**
 * Give LiveKit an exact, zero-offset ArrayBuffer.
 *
 * Node Buffers smaller than the pool size commonly share a larger backing
 * ArrayBuffer with a non-zero byteOffset. rtc-node 0.13.x passes the backing
 * buffer pointer to native code, so handing it a view can encode unrelated
 * pooled bytes. An owned copy keeps the PCM frame boundary exact.
 */
export function ownedPcm16Frame(bytes: Uint8Array): Int16Array {
  if (bytes.byteLength !== BYTES_PER_FRAME) {
    throw new RangeError(`expected ${BYTES_PER_FRAME} PCM bytes, got ${bytes.byteLength}`);
  }
  const owned = new Uint8Array(BYTES_PER_FRAME);
  owned.set(bytes);
  return new Int16Array(owned.buffer);
}
