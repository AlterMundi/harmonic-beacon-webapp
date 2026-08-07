'use client';

import BrandLockup from '@/components/brand/BrandLockup';
import { useLocale } from '@/context/LocaleContext';
import { earlyBirdAuthClient } from '@/lib/early-birds/auth-client';
import type { ListenerCampfireFixture } from '@/lib/early-birds/campfire-prototype';
import { earlyBirdCopy, earlyBirdHomeCopy, listenerMembershipPresentationCopy } from '@/lib/early-birds/copy';
import type { ListenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

import ListenerPlayer from './ListenerPlayer';
import AccessBoundarySync from './AccessBoundarySync';
import CosmicCampfire from './CosmicCampfire';

export default function EarlyBirdHome({
    displayName,
    membership,
    accessKind = 'membership',
    accessUntil = null,
    serverNow = new Date(0).toISOString(),
    dropIns,
    publicAccess = false,
    campfirePrototype = false,
    campfireFixture = 'empty',
}: {
    displayName: string;
    membership: ListenerMembershipPresentation;
    accessKind?: 'membership' | 'free-window' | 'welcome';
    accessUntil?: string | null;
    serverNow?: string;
    dropIns: { es: string | null; en: string | null };
    publicAccess?: boolean;
    campfirePrototype?: boolean;
    campfireFixture?: ListenerCampfireFixture;
}) {
    const { locale } = useLocale();
    const copy = earlyBirdHomeCopy[locale];
    const membershipCopy = listenerMembershipPresentationCopy(earlyBirdCopy[locale], membership);

    async function signOut() {
        await earlyBirdAuthClient.signOut();
        window.location.assign(LISTENER_NAMESPACE.canonical.home);
    }

    return (
        <main className="listener-shell">
            {campfirePrototype && <CosmicCampfire fixture={campfireFixture} />}
            {accessKind !== 'membership' && (
                <AccessBoundarySync
                    expectedKind={accessKind}
                    boundaryAt={accessUntil}
                    serverNow={serverNow}
                />
            )}
            <div className="listener-shell__frame">
                <header className="listener-rail">
                    <BrandLockup href={LISTENER_NAMESPACE.canonical.home} />
                    <div className="listener-rail__actions">
                        {!publicAccess && <details className="listener-account">
                            <summary aria-label={copy.account} title={copy.account}>
                                {displayName.slice(0, 1).toUpperCase()}
                            </summary>
                            <div className="listener-account__menu">
                                <p>{displayName}</p>
                                <span>{accessKind === 'free-window'
                                    ? copy.freeActive
                                    : accessKind === 'welcome'
                                        ? copy.welcomeActive
                                        : membershipCopy?.title ?? copy.active}</span>
                                {accessKind === 'membership' && membership.kind === 'founder' && membershipCopy?.detail && (
                                    <small>{membershipCopy.detail}</small>
                                )}
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
