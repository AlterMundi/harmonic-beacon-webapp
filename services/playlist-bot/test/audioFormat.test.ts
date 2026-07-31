import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BYTES_PER_FRAME,
  decoderArgs,
  MUSIC_BITRATE,
  MUSIC_DTX,
  MUSIC_RED,
  NUM_CHANNELS,
  SAMPLE_RATE,
  SAMPLES_PER_CHANNEL,
} from '../src/audioFormat.js';

test('publishes 48 kHz stereo music frames without a mono downmix', () => {
  assert.equal(SAMPLE_RATE, 48_000);
  assert.equal(NUM_CHANNELS, 2);
  assert.equal(SAMPLES_PER_CHANNEL, 960);
  assert.equal(BYTES_PER_FRAME, 3_840);
  assert.equal(MUSIC_BITRATE, 510_000n);
  assert.equal(MUSIC_DTX, false);
  assert.equal(MUSIC_RED, false);

  const args = decoderArgs('/records/reference.ogg');
  assert.deepEqual(args.slice(args.indexOf('-ar'), args.indexOf('-ar') + 4), [
    '-ar', '48000', '-ac', '2',
  ]);
});
