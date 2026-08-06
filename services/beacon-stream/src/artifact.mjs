import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ARTIFACT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateArtifact(raw) {
  assert(raw && raw.schemaVersion === 1, 'artifact schemaVersion must be 1');
  assert(typeof raw.artifactId === 'string' && ARTIFACT_ID.test(raw.artifactId), 'invalid artifactId');
  assert(raw.approval?.status === 'APPROVED', 'artifact is not explicitly approved for delivery');
  assert(typeof raw.approval?.approvedAt === 'string' && Number.isFinite(Date.parse(raw.approval.approvedAt)), 'approval.approvedAt is required');
  assert(typeof raw.approval?.reviewRecord === 'string' && raw.approval.reviewRecord.length > 0, 'approval.reviewRecord is required');
  assert(typeof raw.source?.masterSha256 === 'string' && SHA256.test(raw.source.masterSha256), 'source.masterSha256 must be SHA-256');
  assert(typeof raw.derivative?.sha256 === 'string' && SHA256.test(raw.derivative.sha256), 'derivative.sha256 must be SHA-256');
  assert(typeof raw.timing?.epochUtc === 'string' && Number.isFinite(Date.parse(raw.timing.epochUtc)), 'timing.epochUtc is required');
  assert(raw.timing?.segmentDurationSeconds === 6, 'only immutable six-second segments are supported');
  assert(Number.isSafeInteger(raw.timing?.segmentCount) && raw.timing.segmentCount > 0, 'timing.segmentCount must be positive');
  assert(Array.isArray(raw.segments) && raw.segments.length === raw.timing.segmentCount, 'one segment inventory entry is required per segment');

  const seen = new Set();
  for (const segment of raw.segments) {
    assert(typeof segment.file === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment.file), 'invalid segment filename');
    assert(!seen.has(segment.file), `duplicate segment filename ${segment.file}`);
    seen.add(segment.file);
    assert(typeof segment.sha256 === 'string' && SHA256.test(segment.sha256), `segment ${segment.file} SHA-256 is required`);
    assert(Number.isSafeInteger(segment.bytes) && segment.bytes > 0, `segment ${segment.file} byte count is required`);
  }

  return Object.freeze({
    ...raw,
    epochMs: Date.parse(raw.timing.epochUtc),
    segmentByFile: new Map(raw.segments.map((segment, index) => [segment.file, { ...segment, index }])),
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
  for (const segment of metadata.segments) {
    const filePath = path.resolve(segmentsRoot, segment.file);
    if (!filePath.startsWith(`${segmentsRoot}${path.sep}`)) throw new Error(`unsafe segment path ${segment.file}`);
    const bytes = await fs.readFile(filePath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    assert(bytes.byteLength === segment.bytes, `byte count changed for ${segment.file}`);
    assert(sha256 === segment.sha256, `checksum changed for ${segment.file}`);
  }
}
