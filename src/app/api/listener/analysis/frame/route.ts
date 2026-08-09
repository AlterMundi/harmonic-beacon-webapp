import {
    isCanonicalListenerHost,
    isListenerStagingHost,
} from '@/lib/listener/public-discovery';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled, earlyBirdsFreeForAll } from '@/lib/early-birds/enabled';
import {
    authorizeEarlyBirdStreamLease,
    authorizeFreeForAllStreamLease,
} from '@/lib/early-birds/stream';
import {
    listenerServerHarmonicAnalyzer,
    serializeServerHarmonicFrame,
} from '@/lib/listener/analysis/server-harmonic-analyzer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
};
const LEASE_ID = /^[0-9a-f-]{36}$/i;
const MAX_AUDIBLE_LATENCY_MS = 90_000;
const MAX_FUTURE_SKEW_MS = 5_000;

export async function GET(request: Request) {
    if (!isCanonicalListenerHost(request.headers) && !isListenerStagingHost(request.headers)) {
        return new Response('not found\n', { status: 404, headers: NO_STORE_HEADERS });
    }
    if (!earlyBirdsEnabled()) {
        return Response.json({ error: 'analysis_unavailable' }, {
            status: 503,
            headers: NO_STORE_HEADERS,
        });
    }
    const parameters = new URL(request.url).searchParams;
    const programTimeMs = Number(parameters.get('at'));
    const leaseId = parameters.get('leaseId') ?? '';
    const leaseGeneration = Number(parameters.get('leaseGeneration'));
    const serverNowMs = Date.now();
    if (!Number.isFinite(programTimeMs)
        || programTimeMs < serverNowMs - MAX_AUDIBLE_LATENCY_MS
        || programTimeMs > serverNowMs + MAX_FUTURE_SKEW_MS
        || !LEASE_ID.test(leaseId)
        || !Number.isSafeInteger(leaseGeneration)
        || leaseGeneration < 1) {
        return Response.json({ error: 'invalid_program_time' }, {
            status: 400,
            headers: NO_STORE_HEADERS,
        });
    }
    const freeForAll = earlyBirdsFreeForAll();
    try {
        if (freeForAll) {
            await authorizeFreeForAllStreamLease(leaseId, leaseGeneration);
        } else {
            const session = await currentEarlyBirdSession(request.headers).catch(() => null);
            if (!session) {
                return Response.json({ error: 'sign_in_required' }, {
                    status: 401,
                    headers: NO_STORE_HEADERS,
                });
            }
            await authorizeEarlyBirdStreamLease(session.user.id, leaseId, leaseGeneration);
        }
    } catch {
        return Response.json({ error: 'listening_lease_inactive' }, {
            status: 403,
            headers: NO_STORE_HEADERS,
        });
    }
    try {
        const frame = await listenerServerHarmonicAnalyzer().frameAt(programTimeMs);
        return Response.json(serializeServerHarmonicFrame(frame), {
            headers: {
                ...NO_STORE_HEADERS,
                'X-Listener-Analysis-Source': 'server',
            },
        });
    } catch {
        return Response.json({ error: 'analysis_unavailable' }, {
            status: 503,
            headers: NO_STORE_HEADERS,
        });
    }
}
