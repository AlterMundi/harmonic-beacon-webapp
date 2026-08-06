import { signedUrl } from './auth.mjs';

const WINDOW_SEGMENTS = 6;

function isoAt(epochMs, sequence, durationSeconds) {
  return new Date(epochMs + sequence * durationSeconds * 1000).toISOString();
}

export function currentSequence(metadata, nowMs = Date.now()) {
  return Math.max(0, Math.floor((nowMs - metadata.epochMs) / (metadata.timing.segmentDurationSeconds * 1000)));
}

export function renderManifest({ metadata, origin, secret, nowMs = Date.now(), tokenTtlSeconds = 120 }) {
  const duration = metadata.timing.segmentDurationSeconds;
  const edgeSequence = currentSequence(metadata, nowMs);
  const firstSequence = Math.max(0, edgeSequence - (WINDOW_SEGMENTS - 1));
  const expiresAt = Math.floor(nowMs / 1000) + tokenTtlSeconds;
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${duration}`,
    `#EXT-X-MEDIA-SEQUENCE:${firstSequence}`,
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];

  for (let sequence = firstSequence; sequence <= edgeSequence; sequence += 1) {
    const index = sequence % metadata.timing.segmentCount;
    const segment = metadata.segments[index];
    if (index === 0 && sequence !== 0) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${isoAt(metadata.epochMs, sequence, duration)}`);
    lines.push(`#EXTINF:${duration.toFixed(3)},`);
    const pathname = `/v1/hls/${metadata.artifactId}/segments/${encodeURIComponent(segment.file)}`;
    // Native HLS does not inherit the manifest query string. Every URI is signed.
    lines.push(signedUrl({ origin, secret, pathname, expiresAt }));
  }
  return `${lines.join('\n')}\n`;
}
