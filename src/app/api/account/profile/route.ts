import { prisma } from '@/lib/db';
import { currentAccountSession } from '@/lib/account/auth';
import { isAccountHost } from '@/lib/account/config';
import { normalizeBeaconDisplayName } from '@/lib/account/profile';

function noStore(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    const session = await currentAccountSession(request.headers);
    if (!session) return noStore({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null) as { displayName?: unknown; revision?: unknown } | null;
    const displayName = normalizeBeaconDisplayName(body?.displayName);
    if (!displayName || !Number.isSafeInteger(body?.revision) || Number(body?.revision) < 1) {
        return noStore({ error: 'invalid_request' }, 400);
    }
    const updated = await prisma.beaconProfile.updateMany({
        where: { accountId: session.user.id, revision: Number(body?.revision) },
        data: { displayName, revision: { increment: 1 } },
    });
    if (updated.count !== 1) return noStore({ error: 'revision_conflict' }, 409);
    const profile = await prisma.beaconProfile.findUniqueOrThrow({
        where: { accountId: session.user.id },
        select: { accountId: true, displayName: true, revision: true },
    });
    return noStore(profile);
}

