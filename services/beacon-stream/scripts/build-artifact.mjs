import fs from 'node:fs/promises';
import path from 'node:path';

import { sha256File } from '../src/inventory.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name) {
  const value = argument(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

const root = path.resolve(required('--artifact-root'));
const artifactId = required('--artifact-id');
const derivative = path.resolve(required('--derivative'));
const masterSha256 = required('--master-sha256');
const epochUtc = required('--epoch-utc');
const approvedAt = required('--approved-at');
const reviewRecord = required('--review-record');
const playlist = await fs.readFile(path.join(root, 'package.m3u8'), 'utf8');
const lines = playlist.split(/\r?\n/);
const mapUri = lines.find((line) => line.startsWith('#EXT-X-MAP:'))?.match(/URI="([^"]+)"/)?.[1];
if (!mapUri) throw new Error('fMP4 initialization map is required');

function mediaName(uri) {
  const normalized = uri.replace(/^segments\//, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) throw new Error(`unsafe media URI ${uri}`);
  return normalized;
}

async function inventory(file, durationSeconds) {
  const filePath = path.join(root, 'segments', file);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size < 1) throw new Error(`invalid media file ${file}`);
  return {
    file,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    bytes: stat.size,
    sha256: await sha256File(filePath),
  };
}

const segmentInputs = [];
for (let index = 0; index < lines.length; index += 1) {
  if (!lines[index].startsWith('#EXTINF:')) continue;
  const durationSeconds = Number(lines[index].slice('#EXTINF:'.length).split(',')[0]);
  const uri = lines[index + 1];
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !uri || uri.startsWith('#')) {
    throw new Error('invalid HLS media entry');
  }
  segmentInputs.push({ file: mediaName(uri), durationSeconds });
}
if (segmentInputs.length < 1) throw new Error('at least one media segment is required');

const segments = [];
for (const segment of segmentInputs) segments.push(await inventory(segment.file, segment.durationSeconds));
const loopDurationSeconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
const metadata = {
  schemaVersion: 2,
  artifactId,
  approval: { status: 'APPROVED', approvedAt, reviewRecord },
  source: { masterSha256 },
  derivative: { sha256: await sha256File(derivative) },
  timing: {
    epochUtc,
    targetSegmentDurationSeconds: 6,
    segmentCount: segments.length,
    loopDurationSeconds,
  },
  initialization: await inventory(mediaName(mapUri)),
  segments,
};
const output = path.join(root, 'artifact.json');
const temporary = `${output}.${process.pid}.tmp`;
// Approval metadata and hashes are intentionally non-secret. The origin runs
// as an unprivileged container user over a read-only media mount, so the
// inventory must remain readable when packaging was performed by root.
await fs.writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
await fs.rename(temporary, output);
console.log(`artifact inventory written: ${segments.length} segments, ${loopDurationSeconds.toFixed(6)} seconds`);
