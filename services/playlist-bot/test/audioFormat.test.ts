import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BYTES_PER_FRAME,
  decoderArgs,
  MUSIC_BITRATE,
  MUSIC_DTX,
  MUSIC_RED,
  NUM_CHANNELS,
  ownedPcm16Frame,
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

test('copies pooled PCM bytes into an exact zero-offset frame for rtc-node', () => {
  const pool = Buffer.alloc(BYTES_PER_FRAME + 128, 0x55);
  const view = pool.subarray(64, 64 + BYTES_PER_FRAME);
  view.writeInt16LE(1234, 0);
  view.writeInt16LE(-2345, 2);

  const frame = ownedPcm16Frame(view);

  assert.equal(frame.byteOffset, 0);
  assert.equal(frame.buffer.byteLength, BYTES_PER_FRAME);
  assert.equal(frame.length, SAMPLES_PER_CHANNEL * NUM_CHANNELS);
  assert.equal(frame[0], 1234);
  assert.equal(frame[1], -2345);
});
