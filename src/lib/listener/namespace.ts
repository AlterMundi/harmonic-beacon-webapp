/**
 * Public Listener namespace during the EarlyBird compatibility window.
 *
 * New integrations should use `canonical`. Existing bookmarks and clients keep
 * working through `legacy`; removing those aliases is a separate, measured
 * migration step.
 */
export const LISTENER_NAMESPACE = {
    publicWebsite: 'https://harmonicbeacon.com/',
    canonical: {
        home: '/listener',
        redeem: '/listener/redeem',
        authError: '/listener?authError=1',
        api: {
            accessState: '/api/listener/access-state',
            freeRedeem: '/api/listener/free/redeem',
            authRecovery: '/api/listener/auth/recover',
        },
    },
    legacy: {
        home: '/early-birds',
        redeem: '/early-birds/redeem',
        authError: '/early-birds?authError=1',
        api: {
            accessState: '/api/early-birds/access-state',
            freeRedeem: '/api/early-birds/free/redeem',
        },
    },
} as const;

export function listenerInvitationQuery(pathname: string): 'invite' | 'token' | null {
    if (
        pathname === LISTENER_NAMESPACE.canonical.home
        || pathname === LISTENER_NAMESPACE.legacy.home
    ) return 'invite';
    if (
        pathname === LISTENER_NAMESPACE.canonical.redeem
        || pathname === LISTENER_NAMESPACE.legacy.redeem
    ) return 'token';
    return null;
}
