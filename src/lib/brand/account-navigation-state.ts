import { storedAccountIdentity } from '@/lib/account-rp';
import { prisma } from '@/lib/db';
import { SESSION_COOKIE_NAME, digestSessionToken } from '@/lib/session-auth';

const MAX_COOKIE_HEADER_BYTES = 8_192;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function exactlyOneSessionToken(headers: Pick<Headers, 'get'>): string | null {
    const cookieHeader = headers.get('cookie');
    if (!cookieHeader || cookieHeader.length > MAX_COOKIE_HEADER_BYTES) return null;

    const values = cookieHeader
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
        .map((part) => part.slice(SESSION_COOKIE_NAME.length + 1));

    return values.length === 1 && SESSION_TOKEN.test(values[0]) ? values[0] : null;
}

/**
 * Produce only a best-effort visual hint for the shared navigation.
 *
 * This deliberately reads the host-local Live session without revalidating it
 * against Account and without updating last-seen or any authorization state.
 * Protected transitions continue to use the ordinary Account authority path.
 */
export async function locallyKnownLiveAccountSession(
    headers: Pick<Headers, 'get'>,
    now = new Date(),
): Promise<boolean> {
    if (process.env.BEACON_ACCOUNT_ENABLED !== 'true') return false;
    const token = exactlyOneSessionToken(headers);
    if (!token) return false;

    try {
        const row = await prisma.webSession.findUnique({
            where: { tokenDigest: digestSessionToken(token) },
            select: {
                id: true,
                expiresAt: true,
                revokedAt: true,
                accountIssuer: true,
                accountSubject: true,
                accountSessionId: true,
                accountValidatedAt: true,
            },
        });
        if (!row || row.revokedAt || row.expiresAt <= now) return false;

        return storedAccountIdentity({
            ...row,
            // The navigation consumes only a boolean and never reads profile
            // data, so do not select the locally cached display name at all.
            accountDisplayName: null,
        }) !== null;
    } catch {
        // Navigation remains neutral when local state/configuration is
        // unavailable. It never turns a display hint into an auth dependency.
        return false;
    }
}
