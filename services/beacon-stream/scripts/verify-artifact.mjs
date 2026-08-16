import path from 'node:path';
import { loadArtifact, verifyArtifactFiles } from '../src/artifact.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const mediaRoot = argument('--media-root');
const artifactId = argument('--artifact');
if (!mediaRoot || !artifactId) {
  console.error('usage: node scripts/verify-artifact.mjs --media-root /mounted/artifacts --artifact approved-artifact-id');
  process.exit(2);
}
const { root, metadata } = await loadArtifact({ mediaRoot: path.resolve(mediaRoot), artifactId });
await verifyArtifactFiles({ root, metadata });
console.log(`verified approved artifact ${metadata.artifactId}: ${metadata.segments.length} immutable segments`);
