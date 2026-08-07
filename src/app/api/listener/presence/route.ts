import { NextResponse } from 'next/server';

import {
    currentRegionalPresence,
} from '@/lib/listener/presence';
import {
    cachedListenerPresence,
    rememberListenerPresence,
} from '@/lib/listener/presence-route-cache';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
    try {
        const snapshot = await currentRegionalPresence();
        rememberListenerPresence(snapshot);
        return NextResponse.json(snapshot, {
            headers: {
                'cache-control': 'public, max-age=5, stale-while-revalidate=20',
            },
        });
    } catch {
        const lastGood = cachedListenerPresence();
        if (lastGood) {
            return NextResponse.json(lastGood, {
                headers: {
                    'cache-control': 'public, max-age=0, stale-while-revalidate=20',
                    warning: '110 - "Response is stale"',
                },
            });
        }
        return NextResponse.json(
            { error: 'Presence temporarily unavailable.' },
            { status: 503, headers: { 'cache-control': 'no-store' } },
        );
    }
}
