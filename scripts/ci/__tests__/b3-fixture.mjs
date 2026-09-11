import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validManifest } from './b2-fixture.mjs';
import { candidateIdentitySha256 } from '../release-manifest.mjs';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function stateFixture(source = 'a') {
  const compose = Buffer.from('services: {}\n');
  const overlay = Buffer.from('services: {}\n# OCI\n');
  const config = readFileSync('deploy/runtime-public-config/production.json');
  const manifest = validManifest();
  manifest.source.gitSha = source.repeat(40);
  manifest.deploymentInputs = { composeSha256: `sha256:${hash(compose)}`, overlaySha256: `sha256:${hash(overlay)}` };
  manifest.configProfiles.production.sha256 = `sha256:${hash(config)}`;
  manifest.qualification.candidateIdentitySha256 = candidateIdentitySha256(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest));
  return { schemaVersion: 'harmonic-beacon.current-state.v4', publication: { generation: source.charCodeAt(0) - 96, id: source.repeat(64), manifestSha256: hash(bytes) }, laneState: 'oci-production',
    manifestSha256: hash(bytes), manifestBase64: bytes.toString('base64'),
    composeBase64: compose.toString('base64'), overlayBase64: overlay.toString('base64'), publicConfigBase64: config.toString('base64') };
}
