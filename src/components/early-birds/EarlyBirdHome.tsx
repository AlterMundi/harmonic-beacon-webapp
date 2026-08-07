'use client';

import BrandLockup from '@/components/brand/BrandLockup';
import { useLocale } from '@/context/LocaleContext';
import { earlyBirdAuthClient } from '@/lib/early-birds/auth-client';
import { earlyBirdHomeCopy } from '@/lib/early-birds/copy';

import ListenerPlayer from './ListenerPlayer';
import AccessBoundarySync from './AccessBoundarySync';

export default function EarlyBirdHome({
    displayName,
    membershipSource,
    accessKind = 'membership',
    accessUntil = null,
    serverNow = new Date(0).toISOString(),
    dropIns,
    publicAccess = false,
}: {
    displayName: string;
    membershipSource: string | null;
    accessKind?: 'membership' | 'free-window' | 'welcome';
    accessUntil?: string | null;
    serverNow?: string;
    dropIns: { es: string | null; en: string | null };
    publicAccess?: boolean;
}) {
    const { locale } = useLocale();
    const copy = earlyBirdHomeCopy[locale];

    async function signOut() {
        await earlyBirdAuthClient.signOut();
        window.location.assign('/early-birds');
    }

    return (
        <main className="listener-shell">
            {accessKind !== 'membership' && (
                <AccessBoundarySync
                    expectedKind={accessKind}
                    boundaryAt={accessUntil}
                    serverNow={serverNow}
                />
            )}
            <div className="listener-shell__frame">
                <header className="listener-rail">
                    <BrandLockup href="/early-birds" />
                    <div className="listener-rail__actions">
                        {!publicAccess && <details className="listener-account">
                            <summary aria-label={copy.account} title={copy.account}>
                                {displayName.slice(0, 1).toUpperCase()}
                            </summary>
                            <div className="listener-account__menu">
                                <p>{displayName}</p>
                                <span>{accessKind === 'free-window'
                                    ? copy.freeActive
                                    : accessKind === 'welcome' ? copy.welcomeActive : copy.active}</span>
                                {membershipSource && <small>{membershipSource}</small>}
                                <button type="button" onClick={signOut}>{copy.signOut}</button>
                            </div>
                        </details>}
                    </div>
                </header>
                <ListenerPlayer dropIns={dropIns} />
            </div>
        </main>
    );
}
