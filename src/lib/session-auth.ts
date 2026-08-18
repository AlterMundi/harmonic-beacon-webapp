import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export const SESSION_COOKIE_NAME = 'hb_session';
export const DEFAULT_SESSION_COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

const SESSION_TOKEN_BYTES = 32;
const SHA256_HEX_LENGTH = 64;
const SCRYPT_KEY_LENGTH = 32;
const scryptAsync = promisify(scrypt);

export const ACCOUNT_PASSWORD_MIN_LENGTH = 12;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 128;

export type IssuedSessionToken = {
    cookieValue: string;
    database: {
        tokenDigest: string;
    };
};

export function digestSessionToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function issueSessionToken(): IssuedSessionToken {
    const cookieValue = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    return {
        cookieValue,
        database: {
            tokenDigest: digestSessionToken(cookieValue),
        },
    };
}

export function constantTimeDigestEqual(leftHex: string, rightHex: string): boolean {
    const left = Buffer.from(leftHex, 'hex');
    const right = Buffer.from(rightHex, 'hex');

    // Keep malformed database/input values out of timingSafeEqual, which throws
    // for unequal buffer lengths.
    if (
        leftHex.length !== SHA256_HEX_LENGTH ||
        rightHex.length !== SHA256_HEX_LENGTH ||
        left.length !== right.length
    ) {
        return false;
    }

    return timingSafeEqual(left, right);
}

export async function verifyStaffPassword(
    password: string,
    encodedDigest: string,
): Promise<boolean> {
    const match = /^scrypt\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(encodedDigest);
    if (!match) {
        return false;
    }

    const salt = Buffer.from(match[1], 'base64url');
    const expected = Buffer.from(match[2], 'base64url');
    if (salt.length < 16 || expected.length !== SCRYPT_KEY_LENGTH) {
        return false;
    }

    const actual = await scryptAsync(password, salt, expected.length) as Buffer;
    return timingSafeEqual(actual, expected);
}

/** Shared credential format for Account password identities. */
export async function hashAccountPassword(password: string): Promise<string> {
    if (password.length < ACCOUNT_PASSWORD_MIN_LENGTH ||
        password.length > ACCOUNT_PASSWORD_MAX_LENGTH) {
        throw new Error('Account password length is outside the accepted range');
    }
    const salt = randomBytes(16);
    const digest = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH) as Buffer;
    return `scrypt-v1$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

export async function verifyAccountPassword(input: {
    hash: string;
    password: string;
}): Promise<boolean> {
    if (input.password.length < ACCOUNT_PASSWORD_MIN_LENGTH ||
        input.password.length > ACCOUNT_PASSWORD_MAX_LENGTH) return false;
    const match = /^scrypt-v1\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(input.hash);
    if (!match) return false;
    const salt = Buffer.from(match[1], 'base64url');
    const expected = Buffer.from(match[2], 'base64url');
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await scryptAsync(input.password, salt, expected.length) as Buffer;
    return timingSafeEqual(actual, expected);
}

export function sessionTokenMatchesDigest(token: string, storedDigest: string): boolean {
    return constantTimeDigestEqual(digestSessionToken(token), storedDigest);
}

export function sessionCookieTtlSeconds(
    rawValue = process.env.SESSION_COOKIE_TTL_SECONDS,
): number {
    if (rawValue === undefined || rawValue === '') {
        return DEFAULT_SESSION_COOKIE_TTL_SECONDS;
    }

    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error('SESSION_COOKIE_TTL_SECONDS must be a positive integer');
    }
    return value;
}

export function sessionCookieOptions(now = new Date()) {
    const maxAge = sessionCookieTtlSeconds();
    return {
        httpOnly: true as const,
        secure: true as const,
        sameSite: 'lax' as const,
        path: '/' as const,
        maxAge,
        expires: new Date(now.getTime() + maxAge * 1000),
    };
}
