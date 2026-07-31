import { readFile } from 'node:fs/promises';

import { NextRequest, NextResponse } from 'next/server';

import { resolveRoomPrincipal } from '@/lib/room-entitlement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function notFound() {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function GET(request: NextRequest) {
    if (process.env.E2E_DASHBOARD_ENABLED !== '1') return notFound();

    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim();
    if (!sessionId) return notFound();
    const entitlement = await resolveRoomPrincipal(request, sessionId);
    if (!entitlement.ok) return notFound();

    const path = process.env.BEACON_REFERENCE_AUDIO_PATH;
    if (!path) return notFound();

    try {
        const file = await readFile(path);
        const range = request.headers.get('range');
        const match = range?.match(/^bytes=(\d+)-(\d*)$/);
        let start = 0;
        let end = file.length - 1;
        let status = 200;
        if (match) {
            start = Number(match[1]);
            end = match[2] ? Math.min(Number(match[2]), end) : end;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.length) {
                return new NextResponse(null, {
                    status: 416,
                    headers: { 'Content-Range': `bytes */${file.length}` },
                });
            }
            status = 206;
        }
        const body = file.subarray(start, end + 1);
        return new NextResponse(body, {
            status,
            headers: {
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'private, no-store',
                'Content-Length': String(body.length),
                'Content-Type': 'audio/ogg',
                ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${file.length}` } : {}),
            },
        });
    } catch {
        return notFound();
    }
}
