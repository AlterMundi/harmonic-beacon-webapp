#!/usr/bin/env node
/**
 * R2 viability smoke test — the gate on decision D4 in docs/CLOUD_MIGRATION_PLAN.md.
 *
 * The app streams audio and the player seeks, so the whole storage decision rests
 * on one question: do presigned GET URLs honour HTTP Range requests? Research said
 * "probably" — that is not good enough for a load-bearing dependency, so this runs it.
 *
 * Checks, in order:
 *   1. PUT an object via the S3 API
 *   2. Presigned GET returns the object (200)
 *   3. Presigned GET with `Range:` returns 206 + correct Content-Range + exact bytes
 *   4. A mid-file range (the actual seek case) returns the right slice
 *   5. Presigned PUT works from a bare fetch (the browser-direct upload path)
 *   6. CORS preflight on the presigned PUT (browser upload fails silently without it)
 *   7. Cleanup
 *
 * Usage — credentials come from the environment, never from a file in the repo:
 *   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
 *   S3_BUCKET=harmonic-beacon \
 *   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *   ORIGIN=https://beacon.altermundi.net \
 *   node scripts/verify-r2.mjs
 *
 * Exit code 0 = R2 is viable for this app. Non-zero = it is not; read the output.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const {
    S3_ENDPOINT,
    S3_BUCKET,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
    S3_REGION = 'auto',
    ORIGIN = 'https://beacon.altermundi.net',
} = process.env;

const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']
    .filter((k) => !process.env[k]);
if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    process.exit(2);
}

const KEY = `_verify/range-probe-${process.pid}.bin`;
// 256 KiB of deterministic bytes — byte i === i % 256, so any slice is checkable
// by value, not just by length. A length-only assertion would pass even if the
// store returned the wrong offset.
const SIZE = 256 * 1024;
const BODY = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) BODY[i] = i % 256;

const s3 = new S3Client({
    region: S3_REGION,
    endpoint: S3_ENDPOINT,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    forcePathStyle: true,
});

const results = [];
function check(name, pass, detail) {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
    console.log(`\nR2 viability probe\n  endpoint : ${S3_ENDPOINT}\n  bucket   : ${S3_BUCKET}\n  key      : ${KEY}\n`);

    // --- 1. PUT via SDK ---
    try {
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET, Key: KEY, Body: BODY, ContentType: 'audio/ogg',
        }));
        check('PUT object via S3 API', true, `${SIZE} bytes`);
    } catch (err) {
        check('PUT object via S3 API', false, err.message);
        return finish();
    }

    // --- 2. presigned GET, full object ---
    const getUrl = await getSignedUrl(s3, new (await import('@aws-sdk/client-s3')).GetObjectCommand({
        Bucket: S3_BUCKET, Key: KEY,
    }), { expiresIn: 300 });

    try {
        const r = await fetch(getUrl);
        const buf = Buffer.from(await r.arrayBuffer());
        const ok = r.status === 200 && buf.length === SIZE && buf.equals(BODY);
        check('presigned GET returns full object', ok,
            `status=${r.status} len=${buf.length} accept-ranges=${r.headers.get('accept-ranges') ?? 'absent'}`);
    } catch (err) {
        check('presigned GET returns full object', false, err.message);
    }

    // --- 3. Range: first 1 KiB — the canonical probe ---
    try {
        const r = await fetch(getUrl, { headers: { Range: 'bytes=0-1023' } });
        const buf = Buffer.from(await r.arrayBuffer());
        const cr = r.headers.get('content-range');
        const ok = r.status === 206
            && buf.length === 1024
            && buf.equals(BODY.subarray(0, 1024))
            && cr === `bytes 0-1023/${SIZE}`;
        check('presigned GET honours Range (head)', ok,
            `status=${r.status} len=${buf.length} content-range=${cr ?? 'absent'}`);
    } catch (err) {
        check('presigned GET honours Range (head)', false, err.message);
    }

    // --- 4. mid-file Range — this is what seeking actually does ---
    const start = 100_000, end = 101_023;
    try {
        const r = await fetch(getUrl, { headers: { Range: `bytes=${start}-${end}` } });
        const buf = Buffer.from(await r.arrayBuffer());
        const ok = r.status === 206
            && buf.length === end - start + 1
            && buf.equals(BODY.subarray(start, end + 1));
        check('presigned GET honours Range (seek, mid-file)', ok,
            `status=${r.status} len=${buf.length} bytes-match=${buf.equals(BODY.subarray(start, end + 1))}`);
    } catch (err) {
        check('presigned GET honours Range (seek, mid-file)', false, err.message);
    }

    // --- 5. presigned PUT — the browser-direct upload path ---
    const putKey = `${KEY}.put`;
    try {
        const putUrl = await getSignedUrl(s3, new PutObjectCommand({
            Bucket: S3_BUCKET, Key: putKey, ContentType: 'audio/ogg',
        }), { expiresIn: 300 });
        const r = await fetch(putUrl, {
            method: 'PUT', body: BODY.subarray(0, 4096),
            headers: { 'Content-Type': 'audio/ogg' },
        });
        check('presigned PUT accepts a bare fetch', r.ok, `status=${r.status}`);
        if (r.ok) await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: putKey }));
    } catch (err) {
        check('presigned PUT accepts a bare fetch', false, err.message);
    }

    // --- 6. CORS preflight — silent killer of browser uploads ---
    try {
        const putUrl = await getSignedUrl(s3, new PutObjectCommand({
            Bucket: S3_BUCKET, Key: `${KEY}.cors`, ContentType: 'audio/ogg',
        }), { expiresIn: 300 });
        const r = await fetch(putUrl, {
            method: 'OPTIONS',
            headers: {
                Origin: ORIGIN,
                'Access-Control-Request-Method': 'PUT',
                'Access-Control-Request-Headers': 'content-type',
            },
        });
        const allow = r.headers.get('access-control-allow-origin');
        check('CORS preflight allows browser PUT', Boolean(allow),
            allow
                ? `allow-origin=${allow}`
                : `no ACAO header (status=${r.status}) — set bucket CORS for ${ORIGIN} or browser uploads fail silently`);
    } catch (err) {
        check('CORS preflight allows browser PUT', false, err.message);
    }

    // --- 7. cleanup ---
    try {
        await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: KEY }));
        check('cleanup', true);
    } catch (err) {
        check('cleanup', false, `${err.message} — leftover object: ${KEY}`);
    }

    return finish();
}

function finish() {
    const failed = results.filter((r) => !r.pass);
    // CORS is configuration, not a capability — it can be fixed on the bucket.
    // Range support cannot, so it alone decides viability.
    const rangeFailed = failed.some((r) => r.name.includes('Range'));

    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (rangeFailed) {
        console.log('\nVERDICT: NOT VIABLE — Range requests are unsupported, so audio seeking');
        console.log('cannot work. Reopen decision D4 and evaluate Backblaze B2 or Tigris.');
    } else if (failed.length) {
        console.log('\nVERDICT: VIABLE, with configuration gaps above (CORS is set on the bucket,');
        console.log('not in code — fix and re-run).');
    } else {
        console.log('\nVERDICT: VIABLE — Range, presigned PUT/GET and CORS all confirmed.');
    }
    process.exit(rangeFailed ? 1 : 0);
}

main().catch((err) => {
    console.error('\nprobe crashed:', err);
    process.exit(3);
});
