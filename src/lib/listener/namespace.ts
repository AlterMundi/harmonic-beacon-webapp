/**
 * Public Listener namespace during the EarlyBird compatibility window.
 *
 * New integrations should use `canonical`. Existing bookmarks and clients keep
 * working through `legacy`; removing those aliases is a separate, measured
 * migration step.
 */
export const LISTENER_NAMESPACE = {
    canonical: {
        home: '/listener',
        redeem: '/listener/redeem',
        api: {
            accessState: '/api/listener/access-state',
            freeWindow: '/api/listener/free-window',
            freeRedeem: '/api/listener/free/redeem',
            welcomeAccess: '/api/listener/welcome-access',
        },
    },
    legacy: {
        home: '/early-birds',
        redeem: '/early-birds/redeem',
        api: {
            accessState: '/api/early-birds/access-state',
            freeWindow: '/api/early-birds/free-window',
            freeRedeem: '/api/early-birds/free/redeem',
            welcomeAccess: '/api/early-birds/welcome-access',
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
