import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

type FrontchannelPayload = {
    v: 1;
    iss: string;
    aud: string;
    sid: string;
    state: string;
    iat: number;
    exp: number;
};

type LogoutInitiationPayload = {
    v: 1;
    iss: string;
    client_id: string;
    sid: string;
    mode: 'current' | 'all';
    return_to: string;
    state: string;
    iat: number;
    exp: number;
};

function signature(encoded: string, secret: string): Buffer {
    return createHmac('sha256', secret).update(encoded, 'utf8').digest();
}

function canonicalBase64Url(value: string): Buffer | null {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const decoded = Buffer.from(value, 'base64url');
    return decoded.toString('base64url') === value ? decoded : null;
}

export function signAccountFrontchannelLogout(input: {
    issuer: string;
    audience: string;
    sid: string;
    clientSecret: string;
    now?: Date;
}): string {
    const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    const payload: FrontchannelPayload = {
        v: 1, iss: input.issuer, aud: input.audience, sid: input.sid,
        state: randomBytes(16).toString('base64url'), iat: now, exp: now + 120,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${encoded}.${signature(encoded, input.clientSecret).toString('base64url')}`;
}

export function verifyAccountFrontchannelLogout(input: {
    token: string;
    issuer: string;
    audience: string;
    clientSecret: string;
    now?: Date;
}): FrontchannelPayload | null {
    if (input.token.length > 2048) return null;
    try {
        const [encoded, presented, extra] = input.token.split('.');
        if (!encoded || !presented || extra) return null;
        const payloadBytes = canonicalBase64Url(encoded);
        const actual = canonicalBase64Url(presented);
        if (!payloadBytes || !actual) return null;
        const expected = signature(encoded, input.clientSecret);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
        const payload = JSON.parse(payloadBytes.toString('utf8')) as FrontchannelPayload;
        const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
        if (payload.v !== 1 || payload.iss !== input.issuer || payload.aud !== input.audience ||
            typeof payload.sid !== 'string' || payload.sid.length < 1 || payload.sid.length > 128 ||
            !/^[A-Za-z0-9_-]{20,64}$/.test(payload.state) ||
            !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
            payload.iat > now + 30 || payload.exp < now || payload.exp > payload.iat + 120) return null;
        return payload;
    } catch { return null; }
}

export function accountFrontchannelURL(input: {
    url: string;
    issuer: string;
    audience: string;
    sid: string;
    clientSecret: string;
}): string {
    const url = new URL(input.url);
    url.searchParams.set('logout_token', signAccountFrontchannelLogout(input));
    return url.toString();
}

export function signAccountLogoutInitiation(input: {
    issuer: string;
    clientId: string;
    sid: string;
    mode: 'current' | 'all';
    returnTo: string;
    clientSecret: string;
    now?: Date;
}): string {
    const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    const payload: LogoutInitiationPayload = {
        v: 1, iss: input.issuer, client_id: input.clientId, sid: input.sid,
        mode: input.mode, return_to: input.returnTo,
        state: randomBytes(16).toString('base64url'), iat: now, exp: now + 120,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${encoded}.${signature(encoded, input.clientSecret).toString('base64url')}`;
}

export function verifyAccountLogoutInitiation(input: {
    token: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    sid: string;
    mode: 'current' | 'all';
    returnTo: string;
    now?: Date;
}): boolean {
    if (input.token.length > 2048) return false;
    try {
        const [encoded, presented, extra] = input.token.split('.');
        if (!encoded || !presented || extra) return false;
        const payloadBytes = canonicalBase64Url(encoded);
        const actual = canonicalBase64Url(presented);
        if (!payloadBytes || !actual) return false;
        const expected = signature(encoded, input.clientSecret);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
        const payload = JSON.parse(payloadBytes.toString('utf8')) as LogoutInitiationPayload;
        const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
        return payload.v === 1 && payload.iss === input.issuer && payload.client_id === input.clientId &&
            payload.sid === input.sid && payload.mode === input.mode && payload.return_to === input.returnTo &&
            /^[A-Za-z0-9_-]{20,64}$/.test(payload.state) && Number.isSafeInteger(payload.iat) &&
            Number.isSafeInteger(payload.exp) && payload.iat <= now + 30 && payload.exp >= now &&
            payload.exp <= payload.iat + 120;
    } catch { return false; }
}
