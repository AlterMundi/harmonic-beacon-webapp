import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LISTENER_NAMESPACE, listenerInvitationQuery } from '@/lib/listener/namespace';

describe('Listener namespace contract', () => {
    it('publishes only current Listener non-media API names', () => {
        expect(LISTENER_NAMESPACE.canonical).toEqual({
            home: '/listener',
            redeem: '/listener/redeem',
            membership: '/listener/membership',
            authError: '/listener?authError=1',
            api: {
                accessState: '/api/listener/access-state',
                freeRedeem: '/api/listener/free/redeem',
                authRecovery: '/api/listener/auth/recover',
            },
        });
        expect(LISTENER_NAMESPACE.legacy.home).toBe('/early-birds');
        expect(LISTENER_NAMESPACE.legacy.redeem).toBe('/early-birds/redeem');
        expect(LISTENER_NAMESPACE.legacy.authError).toBe('/early-birds?authError=1');
    });

    it.each([
        ['/listener', 'invite'],
        ['/early-birds', 'invite'],
        ['/listener/redeem', 'token'],
        ['/early-birds/redeem', 'token'],
    ] as const)('uses the same invitation exchange for %s', (pathname, query) => {
        expect(listenerInvitationQuery(pathname)).toBe(query);
    });

    it('does not capture tokens on lookalike or nested routes', () => {
        expect(listenerInvitationQuery('/listener-other')).toBeNull();
        expect(listenerInvitationQuery('/listener/redeem/extra')).toBeNull();
    });

    it('keeps canonical Listener changes inside the Fast Forward CI gate', () => {
        const workflow = readFileSync(
            resolve(process.cwd(), '.github/workflows/early-birds-fast-forward.yml'),
            'utf8',
        );
        for (const path of [
            'src/app/api/listener/**',
            'src/app/listener/**',
            'src/lib/listener/**',
        ]) {
            expect(workflow.match(new RegExp(path.replaceAll('*', '\\*'), 'g'))).toHaveLength(2);
        }
    });
});
