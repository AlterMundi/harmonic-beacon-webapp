import { isAbsolute } from 'node:path';
import { open, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { NextRequest, NextResponse } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled, earlyBirdsUnavailableResponse } from '@/lib/early-birds/enabled';
import { getEarlyBirdAccess } from '@/lib/early-birds/membership';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PRIVATE_HEADERS = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Type': 'audio/mp4',
    'X-Content-Type-Options': 'nosniff',
};

function unavailable() {
    return NextResponse.json({ error: 'Drop-in unavailable.' }, {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}

async function serve(
    request: NextRequest,
    context: { params: Promise<{ language: string }> },
    head: boolean,
) {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) {
        return NextResponse.json({ error: 'Sign in required.' }, {
            status: 401,
            headers: { 'Cache-Control': 'private, no-store' },
        });
    }
    const access = await getEarlyBirdAccess(session.user.id).catch(() => null);
    if (!access?.allowed) {
        return NextResponse.json({ error: 'Membership inactive.' }, {
            status: 403,
            headers: { 'Cache-Control': 'private, no-store' },
        });
    }

    const { language } = await context.params;
    const configuredPath = language === 'es'
        ? process.env.EARLY_BIRDS_DROPIN_ES_PATH
        : language === 'en' ? process.env.EARLY_BIRDS_DROPIN_EN_PATH : undefined;
    if (!configuredPath || !isAbsolute(configuredPath)) return unavailable();

    try {
        const metadata = await stat(configuredPath);
        if (!metadata.isFile()) return unavailable();
        const fileSize = metadata.size;
        const match = request.headers.get('range')?.match(/^bytes=(\d+)-(\d*)$/);
        let start = 0;
        let end = fileSize - 1;
        let status = 200;
        if (match) {
            start = Number(match[1]);
            end = match[2] ? Math.min(Number(match[2]), end) : end;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= fileSize) {
                return new NextResponse(null, {
                    status: 416,
                    headers: { ...PRIVATE_HEADERS, 'Content-Range': `bytes */${fileSize}` },
                });
            }
            status = 206;
        }
        const contentLength = Math.max(0, end - start + 1);
        if (head || contentLength === 0) {
            return new NextResponse(null, {
                status,
                headers: {
                    ...PRIVATE_HEADERS,
                    'Content-Length': String(contentLength),
                    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${fileSize}` } : {}),
                },
            });
        }

        const file = await open(configuredPath, 'r');
        const body = Readable.toWeb(file.createReadStream({
            start,
            end,
            autoClose: true,
        })) as ReadableStream<Uint8Array>;
        return new NextResponse(body, {
            status,
            headers: {
                ...PRIVATE_HEADERS,
                'Content-Length': String(contentLength),
                ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${fileSize}` } : {}),
            },
        });
    } catch {
        return unavailable();
    }
}

export function GET(request: NextRequest, context: { params: Promise<{ language: string }> }) {
    return serve(request, context, false);
}

export function HEAD(request: NextRequest, context: { params: Promise<{ language: string }> }) {
    return serve(request, context, true);
}
