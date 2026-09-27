/** No ambient fallback: an absent/malformed endpoint must never target another host. */
export function requiredLivekitUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.LIVEKIT_URL?.trim();
  if (!value) throw new Error('LIVEKIT_URL is required');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('LIVEKIT_URL must be a valid ws:// or wss:// endpoint'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('LIVEKIT_URL must be a ws:// or wss:// endpoint without embedded credentials');
  }
  return value;
}
