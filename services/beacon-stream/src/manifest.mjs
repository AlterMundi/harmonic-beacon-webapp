import { signedUrl } from './auth.mjs';

// Listener values continuity over realtime latency. Fifty six-second entries
// retain a five-minute recovery window while the player deliberately starts
// two minutes behind the edge. This is still a small, deterministic playlist
// and avoids making one delayed request an audible interruption.
export const WINDOW_SEGMENTS = 50;

export function currentSequence(metadata, nowMs = Date.now()) {
  const elapsedSeconds = Math.max(0, (nowMs - metadata.epochMs) / 1000);
  if (metadata.schemaVersion === 1) {
    return Math.floor(elapsedSeconds / metadata.timing.segmentDurationSeconds);
  }
  const cycle = Math.floor(elapsedSeconds / metadata.loopDurationSeconds);
  const position = elapsedSeconds - cycle * metadata.loopDurationSeconds;
  const index = metadata.segments.findIndex((segment, candidate) => (
    position < metadata.segmentStartsSeconds[candidate] + segment.durationSeconds
  ));
  return cycle * metadata.timing.segmentCount + Math.max(0, index);
}

function segmentAtSequence(metadata, sequence) {
  const count = metadata.timing.segmentCount;
  const index = sequence % count;
  const cycle = Math.floor(sequence / count);
  return {
    index,
    segment: metadata.segments[index],
    startsAtMs: metadata.epochMs
      + (cycle * metadata.loopDurationSeconds + metadata.segmentStartsSeconds[index]) * 1000,
  };
}

export function renderManifest({
  metadata,
  origin,
  secret,
  nowMs = Date.now(),
  tokenTtlSeconds = 120,
  authorizationExpiresAtSeconds = Number.POSITIVE_INFINITY,
  windowSegments = WINDOW_SEGMENTS,
  mediaAuthorizationQuery = null,
}) {
  if (!Number.isSafeInteger(windowSegments) || windowSegments < 6 || windowSegments > 150) {
    throw new Error('windowSegments must be an integer between 6 and 150');
  }
  const edgeSequence = currentSequence(metadata, nowMs);
  const firstSequence = Math.max(0, edgeSequence - (windowSegments - 1));
  const expiresAt = Math.min(
    Math.floor(nowMs / 1000) + tokenTtlSeconds,
    authorizationExpiresAtSeconds,
  );
  const targetDuration = Math.ceil(Math.max(...metadata.segments.map((segment) => segment.durationSeconds)));
  const discontinuitiesRemoved = Math.floor(
    Math.max(0, firstSequence - 1) / metadata.timing.segmentCount,
  );
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitiesRemoved}`,
    `#EXT-X-MEDIA-SEQUENCE:${firstSequence}`,
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];

  const mediaUrl = (pathname) => {
    if (mediaAuthorizationQuery) {
      const url = new URL(pathname, origin);
      url.searchParams.set('grantId', mediaAuthorizationQuery.grantId);
      url.searchParams.set('grant', mediaAuthorizationQuery.grant);
      return url.toString();
    }
    return signedUrl({ origin, secret, pathname, expiresAt });
  };

  if (metadata.initialization) {
    const pathname = `/v1/hls/${metadata.artifactId}/segments/${encodeURIComponent(metadata.initialization.file)}`;
    lines.push(`#EXT-X-MAP:URI="${mediaUrl(pathname)}"`);
  }

  for (let sequence = firstSequence; sequence <= edgeSequence; sequence += 1) {
    const { index, segment, startsAtMs } = segmentAtSequence(metadata, sequence);
    if (index === 0 && sequence !== 0) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(startsAtMs).toISOString()}`);
    lines.push(`#EXTINF:${segment.durationSeconds.toFixed(6)},`);
    const pathname = `/v1/hls/${metadata.artifactId}/segments/${encodeURIComponent(segment.file)}`;
    // Native HLS does not inherit the manifest query string. Every URI is signed.
    lines.push(mediaUrl(pathname));
  }
  return `${lines.join('\n')}\n`;
}
