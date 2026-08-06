import { isAbsolute } from 'node:path';
import { readFile } from 'node:fs/promises';

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
        const file = await readFile(configuredPath);
        const match = request.headers.get('range')?.match(/^bytes=(\d+)-(\d*)$/);
        let start = 0;
        let end = file.length - 1;
        let status = 200;
        if (match) {
            start = Number(match[1]);
            end = match[2] ? Math.min(Number(match[2]), end) : end;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.length) {
                return new NextResponse(null, {
                    status: 416,
                    headers: { ...PRIVATE_HEADERS, 'Content-Range': `bytes */${file.length}` },
                });
            }
            status = 206;
        }
        const body = file.subarray(start, end + 1);
        return new NextResponse(head ? null : body, {
            status,
            headers: {
                ...PRIVATE_HEADERS,
                'Content-Length': String(body.length),
                ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${file.length}` } : {}),
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
