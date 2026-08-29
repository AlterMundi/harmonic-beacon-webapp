import { createHmac, timingSafeEqual } from 'node:crypto';

function b64url(value) {
    return Buffer.from(value).toString('base64url');
}

export function digest(value, secret) {
    return createHmac('sha256', secret).update(value).digest('hex');
}

export function signHandoff(payload, secret, now = Date.now()) {
    const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 900 }));
    const signature = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${signature}`;
}

export function verifyHandoff(token, secret, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const [body, supplied, extra] = token.split('.');
    if (!body || !supplied || extra) return null;
    const expected = createHmac('sha256', secret).update(body).digest();
    let actual;
    try { actual = Buffer.from(supplied, 'base64url'); } catch { return null; }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        const seconds = Math.floor(now / 1000);
        if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
            || payload.iat > seconds + 60 || payload.exp < seconds || payload.exp - payload.iat > 900) return null;
        return payload;
    } catch {
        return null;
    }
}

export function verifyServerSignature({ timestamp, signature, body, secret, now = Date.now() }) {
    const seconds = Number(timestamp);
    if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(now / 1000) - seconds) > 300) return false;
    const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
    let actual;
    try { actual = Buffer.from(signature ?? '', 'hex'); } catch { return false; }
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
