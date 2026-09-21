import { accountClientRequiresCompleteProfile } from '@/lib/account/config';
import { prisma } from '@/lib/db';
import { isBeaconProfileComplete } from '@/lib/account/profile';

export async function accountUserInfoClaims(input: {
    user: { id: string; email: string };
    scopes: string[];
}): Promise<Record<string, unknown>> {
    const profile = await prisma.beaconProfile.findUnique({
        where: { accountId: input.user.id },
        select: { displayName: true, realName: true, revision: true },
    });
    return {
        ...(input.scopes.includes('profile') ? {
            name: profile?.displayName ?? 'Beacon Listener',
            preferred_name: profile?.displayName ?? 'Beacon Listener',
            profile_revision: profile?.revision ?? 1,
            profile_complete: isBeaconProfileComplete(profile),
        } : {}),
        ...(input.scopes.includes('email') && input.user.email.endsWith('@identity.invalid') ? {
            email: undefined,
            email_verified: false,
        } : {}),
        picture: undefined,
        given_name: undefined,
        family_name: undefined,
    };
}

export async function accountOAuthProfileCompletionRequired(
    accountId: string,
    clientId: string | null,
): Promise<boolean> {
    if (!accountClientRequiresCompleteProfile(clientId)) return false;
    const profile = await prisma.beaconProfile.findUnique({
        where: { accountId },
        select: { displayName: true, realName: true },
    });
    return !isBeaconProfileComplete(profile);
}

