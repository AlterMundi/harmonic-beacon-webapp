import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import { listenerAccountRPConfig } from '@/lib/listener/account-rp';
import { listenerProfileSummary } from '@/lib/listener/profile-summary';
import { isCanonicalListenerHost, isListenerStagingHost } from '@/lib/listener/public-discovery';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
    const incoming = new Headers(request.headers);
    const staging = isListenerStagingHost(incoming);
    if ((!staging && !isCanonicalListenerHost(incoming)) || !earlyBirdsEnabled()) return new Response(null, { status: 404 });
    const allowedOrigin = staging ? 'https://live-staging.harmonicbeacon.com' : 'https://live.harmonicbeacon.com';
    // Only the corresponding Live environment may read this credentialed response.
    const origin = incoming.get('origin');
    if (origin !== allowedOrigin) return new Response(null, { status: 403 });
    const headers = {
        'Cache-Control': 'private, no-store', Vary: 'Origin',
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'X-Content-Type-Options': 'nosniff',
    };
    try {
        const session = await currentEarlyBirdSession(incoming);
        if (!session) return Response.json({ error: 'authentication_required' }, { status: 401, headers });
        const { issuer } = listenerAccountRPConfig(incoming);
        const summary = await listenerProfileSummary(session.user.id, issuer);
        return summary ? Response.json(summary, { headers })
            : Response.json({ error: 'account_unavailable' }, { status: 409, headers });
    } catch {
        return Response.json({ error: 'profile_unavailable' }, { status: 503, headers });
    }
}
