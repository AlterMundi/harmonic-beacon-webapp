import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Hash a media file incrementally. The immutable master can be several GB, so
 * it must never be materialized as one Buffer merely to inventory it.
 */
export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}
