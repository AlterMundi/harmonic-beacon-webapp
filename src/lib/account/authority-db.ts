import { prisma } from '@/lib/db';
import { accountOrigin } from '@/lib/account/config';

export async function accountAuthorityDatabaseReady(): Promise<boolean> {
    try {
        const marker = await prisma.beaconAccountAuthorityEnvironment.findUnique({
            where: { id: 'authority' }, select: { issuer: true },
        });
        return marker?.issuer === accountOrigin();
    } catch { return false; }
}
export async function assertAccountAuthorityDatabase(): Promise<void> {
    if (!await accountAuthorityDatabaseReady()) {
        throw new Error('Account authority database issuer marker is absent or mismatched');
    }
}
