import { accountAuth } from '@/lib/account/auth';
import { accountAuthorityDatabaseReady } from '@/lib/account/authority-db';
import { prisma } from '@/lib/db';

let renewal: Promise<void> | null = null;

/** Renew through the provider before readiness can fence off all sign-ins.
 * The discarded maintenance token has no subject or relying-party audience.
 * Old keys remain under the provider's normal verification grace period. */
export async function accountSigningKeyReady(): Promise<boolean> {
    const liveKey = () => prisma.beaconJwks.count({ where: {
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    } });
    try {
        if (!await accountAuthorityDatabaseReady()) return false;
        if (await liveKey() > 0) return true;
        if (!renewal) {
            renewal = (async () => {
                await accountAuth().api.signJWT({ body: { payload: {
                    aud: 'urn:harmonic-beacon:signing-key-maintenance',
                    exp: Math.floor(Date.now() / 1_000) + 1,
                } } });
            })().finally(() => { renewal = null; });
        }
        await renewal;
        return await liveKey() > 0;
    } catch { return false; }
}
