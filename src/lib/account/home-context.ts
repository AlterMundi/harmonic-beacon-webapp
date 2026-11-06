import { createHash } from 'node:crypto';

import { accountEnvironment, accountOrigin } from './config';

/** Only the current Account subject is used; email is never an identity join. */
export function accountHomeContext(accountId: string) {
    const staging = accountEnvironment() === 'staging';
    return {
        identityKey: createHash('sha256').update(`hb-profile-v1\0${accountOrigin()}\0${accountId}`).digest('hex'),
        listenerOrigin: staging ? 'https://earlybirds-staging.harmonicbeacon.com' as const : 'https://listen.harmonicbeacon.com' as const,
    };
}
