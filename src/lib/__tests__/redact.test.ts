import { describe, it, expect } from 'vitest';
import { redactSecrets, redactError, REDACTED } from '../redact';

describe('redactSecrets', () => {
    it('redacts the password from a postgres connection string', () => {
        const out = redactSecrets('postgresql://beacon:hunter2@db.internal:5432/harmonic_beacon');
        expect(out).not.toContain('hunter2');
        expect(out).toBe(`postgresql://beacon:${REDACTED}@db.internal:5432/harmonic_beacon`);
    });

    it('keeps the host, port, database and username so the line stays diagnostic', () => {
        const out = redactSecrets('postgresql://neondb_owner:npg_abc123@ep-x-pooler.neon.tech/neondb');
        expect(out).toContain('ep-x-pooler.neon.tech');
        expect(out).toContain('neondb_owner');
        expect(out).toContain('/neondb');
        expect(out).not.toContain('npg_abc123');
    });

    it('redacts credentials embedded in a longer error message', () => {
        const out = redactSecrets(
            'connection refused: password authentication failed for postgres://beacon:s3cr3t@10.0.0.5:5432/db',
        );
        expect(out).toContain('connection refused');
        expect(out).not.toContain('s3cr3t');
    });

    it('redacts the SigV4 signature from a presigned R2 URL', () => {
        const url =
            'https://acct.r2.cloudflarestorage.com/bucket/meditations/a.ogg' +
            '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
            '&X-Amz-Credential=AKIAEXAMPLE%2F20260725%2Fauto%2Fs3%2Faws4_request' +
            '&X-Amz-Date=20260725T000000Z&X-Amz-Expires=3600' +
            '&X-Amz-Signature=deadbeefcafe1234';
        const out = redactSecrets(url);
        expect(out).not.toContain('deadbeefcafe1234');
        expect(out).not.toContain('AKIAEXAMPLE');
        // The object key must survive — it is the whole point of logging the URL.
        expect(out).toContain('meditations/a.ogg');
        expect(out).toContain('X-Amz-Expires=3600');
    });

    it('redacts sensitive query params case-insensitively', () => {
        const out = redactSecrets('https://x/y?Token=abc&PASSWORD=def&keep=yes');
        expect(out).not.toContain('abc');
        expect(out).not.toContain('def');
        expect(out).toContain('keep=yes');
    });

    it('handles multiple credential pairs in one string', () => {
        const out = redactSecrets(
            'primary=postgres://a:pw1@h1/db replica=postgres://b:pw2@h2/db',
        );
        expect(out).not.toContain('pw1');
        expect(out).not.toContain('pw2');
    });

    it('leaves strings without secrets untouched', () => {
        const clean = 'ECONNREFUSED 127.0.0.1:5432';
        expect(redactSecrets(clean)).toBe(clean);
    });

    it('does not mistake a bare url for credentials', () => {
        const url = 'https://beacon.altermundi.net/api/health';
        expect(redactSecrets(url)).toBe(url);
    });
});

describe('redactError', () => {
    it('renders an Error as name plus redacted message', () => {
        const out = redactError(new Error('fail postgres://u:p@h/db'));
        expect(out).toBe(`Error: fail postgres://u:${REDACTED}@h/db`);
    });

    it('omits the stack trace', () => {
        const err = new Error('boom');
        const out = redactError(err);
        expect(out).not.toContain('at ');
        expect(out).toBe('Error: boom');
    });

    it('redacts a thrown string', () => {
        expect(redactError('postgres://u:pw@h/db')).not.toContain('pw');
    });

    it('handles non-Error, non-string values', () => {
        expect(redactError({ url: 'postgres://u:pw@h/db' })).not.toContain('pw');
        expect(redactError(null)).toBe('null');
    });

    it('survives an unserializable value', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(redactError(circular)).toBe('[unserializable error]');
    });
});
