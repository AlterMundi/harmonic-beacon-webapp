import crypto from 'node:crypto';

export const DEFAULT_MAX_TOKEN_TTL_SECONDS = 10 * 60;

function canonicalRequest(method, pathname, expiresAt) {
  return `${method.toUpperCase()}\n${pathname}\n${expiresAt}`;
}

export function signPath({ secret, method = 'GET', pathname, expiresAt }) {
  if (!secret || secret.length < 32) {
    throw new Error('BEACON_STREAM_SIGNING_SECRET must contain at least 32 characters');
  }
  if (!Number.isSafeInteger(expiresAt)) {
    throw new Error('expiresAt must be a Unix timestamp in whole seconds');
  }

  return crypto.createHmac('sha256', secret)
    .update(canonicalRequest(method, pathname, expiresAt))
    .digest('base64url');
}

export function verifySignedPath({
  secret,
  method = 'GET',
  pathname,
  expiresAt,
  signature,
  now = Math.floor(Date.now() / 1000),
  maxTtlSeconds = DEFAULT_MAX_TOKEN_TTL_SECONDS,
}) {
  if (!Number.isSafeInteger(expiresAt) || !signature || typeof signature !== 'string') return false;
  // Tokens cannot be minted arbitrarily far ahead, limiting replay if a URL leaks.
  if (expiresAt <= now || expiresAt > now + maxTtlSeconds) return false;

  const expectedBytes = Buffer.from(signPath({ secret, method, pathname, expiresAt }));
  const suppliedBytes = Buffer.from(signature);
  return expectedBytes.length === suppliedBytes.length
    && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

export function signedUrl({ origin, secret, pathname, expiresAt, method = 'GET' }) {
  const url = new URL(pathname, origin);
  url.searchParams.set('exp', String(expiresAt));
  url.searchParams.set('sig', signPath({ secret, method, pathname, expiresAt }));
  return url.toString();
}
