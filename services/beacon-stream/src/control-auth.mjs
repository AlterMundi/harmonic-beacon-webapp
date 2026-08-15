import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const CONTROL_CLOCK_SKEW_SECONDS = 30;

export function controlBodyHash(body) {
  return createHash('sha256').update(body).digest('hex');
}

export function signControlRequest({ secret, method = 'PUT', pathname, timestamp, body }) {
  const canonical = `${method}\n${pathname}\n${controlBodyHash(body)}\n${timestamp}`;
  return createHmac('sha256', secret).update(canonical).digest('base64url');
}

export function verifyControlRequest({ secret, method, pathname, timestamp, body, signature, nowMs = Date.now() }) {
  if (!/^\d{10}$/.test(String(timestamp)) || !/^[A-Za-z0-9_-]{43}$/.test(String(signature))) return false;
  const timestampSeconds = Number(timestamp);
  if (Math.abs(Math.floor(nowMs / 1000) - timestampSeconds) > CONTROL_CLOCK_SKEW_SECONDS) return false;
  const expected = signControlRequest({ secret, method, pathname, timestamp: timestampSeconds, body });
  const suppliedBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

