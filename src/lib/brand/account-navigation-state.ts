import { accountClaimIsOpaque, accountIssuerIsCurrent } from '@/lib/account-rp';
import { prisma } from '@/lib/db';
import type { LocalizedStaffRole } from '@/lib/i18n';
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
    return Boolean(await locallyKnownLiveNavigationIdentity(headers, now));
}

export type LocalLiveNavigationIdentity = {
    displayName: string | null;
    staffRole: LocalizedStaffRole | null;
};

/**
 * Resolve the minimum host-local presentation used inside the global user
 * menu. This is deliberately not an authorization check: it performs one
 * read-only database lookup, never revalidates with Account and never updates
 * session activity. Protected Live and Ops routes still resolve their ordinary
 * principal independently.
 */
export async function locallyKnownLiveNavigationIdentity(
    headers: Pick<Headers, 'get'>,
    now = new Date(),
): Promise<LocalLiveNavigationIdentity | null> {
    if (process.env.BEACON_ACCOUNT_ENABLED !== 'true') return null;
    const token = exactlyOneSessionToken(headers);
    if (!token) return null;

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
                accountDisplayName: true,
                accountValidatedAt: true,
                staffUser: {
                    select: {
                        role: true,
                        disabledAt: true,
                        accountBinding: {
                            select: {
                                accountIssuer: true,
                                accountSubject: true,
                                disabledAt: true,
                            },
                        },
                    },
                },
            },
        });
        if (!row || row.revokedAt || row.expiresAt <= now) return null;

        if (
            !accountIssuerIsCurrent(row.accountIssuer) ||
            !accountClaimIsOpaque(row.accountSubject) ||
            !accountClaimIsOpaque(row.accountSessionId) ||
            !row.accountValidatedAt
        ) return null;
        const binding = row.staffUser?.accountBinding;
        const isStaff = Boolean(
            row.staffUser &&
            row.staffUser.disabledAt === null &&
            binding &&
            binding.disabledAt === null &&
            binding.accountIssuer === row.accountIssuer &&
            binding.accountSubject === row.accountSubject
        );

        return {
            displayName: row.accountDisplayName?.trim() || null,
            staffRole: isStaff ? row.staffUser!.role : null,
        };
    } catch {
        // Navigation remains neutral when local state/configuration is
        // unavailable. It never turns a display hint into an auth dependency.
        return null;
    }
}
