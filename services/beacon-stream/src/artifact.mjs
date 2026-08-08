import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ARTIFACT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateArtifact(raw) {
  assert(raw && [1, 2].includes(raw.schemaVersion), 'artifact schemaVersion must be 1 or 2');
  assert(typeof raw.artifactId === 'string' && ARTIFACT_ID.test(raw.artifactId), 'invalid artifactId');
  assert(raw.approval?.status === 'APPROVED', 'artifact is not explicitly approved for delivery');
  assert(typeof raw.approval?.approvedAt === 'string' && Number.isFinite(Date.parse(raw.approval.approvedAt)), 'approval.approvedAt is required');
  assert(typeof raw.approval?.reviewRecord === 'string' && raw.approval.reviewRecord.length > 0, 'approval.reviewRecord is required');
  assert(typeof raw.source?.masterSha256 === 'string' && SHA256.test(raw.source.masterSha256), 'source.masterSha256 must be SHA-256');
  assert(typeof raw.derivative?.sha256 === 'string' && SHA256.test(raw.derivative.sha256), 'derivative.sha256 must be SHA-256');
  assert(typeof raw.timing?.epochUtc === 'string' && UTC_TIMESTAMP.test(raw.timing.epochUtc) && Number.isFinite(Date.parse(raw.timing.epochUtc)), 'timing.epochUtc must be an explicit UTC timestamp ending in Z');
  if (raw.schemaVersion === 1) {
    assert(raw.timing?.segmentDurationSeconds === 6, 'only immutable six-second segments are supported');
  } else {
    assert(raw.timing?.targetSegmentDurationSeconds === 6, 'only immutable six-second target segments are supported');
    assert(Number.isFinite(raw.timing?.loopDurationSeconds) && raw.timing.loopDurationSeconds > 0, 'timing.loopDurationSeconds is required');
    assert(raw.initialization && typeof raw.initialization === 'object', 'initialization metadata is required for schemaVersion 2');
  }
  assert(Number.isSafeInteger(raw.timing?.segmentCount) && raw.timing.segmentCount > 0, 'timing.segmentCount must be positive');
  assert(Array.isArray(raw.segments) && raw.segments.length === raw.timing.segmentCount, 'one segment inventory entry is required per segment');

  const seen = new Set();
  const validateFile = (item, label) => {
    assert(typeof item?.file === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.file), `invalid ${label} filename`);
    assert(!seen.has(item.file), `duplicate media filename ${item.file}`);
    seen.add(item.file);
    assert(typeof item.sha256 === 'string' && SHA256.test(item.sha256), `${label} ${item.file} SHA-256 is required`);
    assert(Number.isSafeInteger(item.bytes) && item.bytes > 0, `${label} ${item.file} byte count is required`);
  };
  if (raw.schemaVersion === 2) validateFile(raw.initialization, 'initialization');
  for (const segment of raw.segments) {
    validateFile(segment, 'segment');
    if (raw.schemaVersion === 2) {
      assert(Number.isFinite(segment.durationSeconds) && segment.durationSeconds > 0 && segment.durationSeconds <= 6.1, `segment ${segment.file} duration is invalid`);
    }
  }
  if (raw.schemaVersion === 2) {
    const measuredLoopDuration = raw.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    assert(Math.abs(measuredLoopDuration - raw.timing.loopDurationSeconds) < 0.001, 'segment durations do not match timing.loopDurationSeconds');
  }

  const segments = raw.segments.map((segment) => ({
    ...segment,
    durationSeconds: raw.schemaVersion === 1 ? raw.timing.segmentDurationSeconds : segment.durationSeconds,
  }));
  const mediaFiles = raw.schemaVersion === 2 ? [raw.initialization, ...segments] : segments;
  let elapsedSeconds = 0;
  const segmentStartsSeconds = segments.map((segment) => {
    const start = elapsedSeconds;
    elapsedSeconds += segment.durationSeconds;
    return start;
  });

  return Object.freeze({
    ...raw,
    segments,
    epochMs: Date.parse(raw.timing.epochUtc),
    loopDurationSeconds: raw.schemaVersion === 1
      ? raw.timing.segmentDurationSeconds * raw.timing.segmentCount
      : raw.timing.loopDurationSeconds,
    segmentStartsSeconds,
    segmentByFile: new Map(mediaFiles.map((segment, index) => [segment.file, { ...segment, index }])),
  });
}

export async function loadArtifact({ mediaRoot, artifactId }) {
  if (!ARTIFACT_ID.test(artifactId)) throw new Error('invalid artifactId');
  const root = path.resolve(mediaRoot, artifactId);
  const metadata = validateArtifact(JSON.parse(await fs.readFile(path.join(root, 'artifact.json'), 'utf8')));
  assert(metadata.artifactId === artifactId, 'artifact ID does not match its directory');
  return { root, metadata };
}

export async function verifyArtifactFiles({ root, metadata }) {
  const segmentsRoot = path.resolve(root, 'segments');
  const mediaFiles = metadata.initialization
    ? [metadata.initialization, ...metadata.segments]
    : metadata.segments;
  for (const segment of mediaFiles) {
    const filePath = path.resolve(segmentsRoot, segment.file);
    if (!filePath.startsWith(`${segmentsRoot}${path.sep}`)) throw new Error(`unsafe segment path ${segment.file}`);
    const bytes = await fs.readFile(filePath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    assert(bytes.byteLength === segment.bytes, `byte count changed for ${segment.file}`);
    assert(sha256 === segment.sha256, `checksum changed for ${segment.file}`);
  }
}
