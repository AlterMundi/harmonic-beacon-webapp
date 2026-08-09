'use client';

import BrandLockup from '@/components/brand/BrandLockup';
import { useLocale } from '@/context/LocaleContext';
import { earlyBirdAuthClient } from '@/lib/early-birds/auth-client';
import { earlyBirdCopy, earlyBirdHomeCopy, listenerMembershipPresentationCopy } from '@/lib/early-birds/copy';
import type { ListenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

import ListenerPlayer from './ListenerPlayer';
import FreeQuotaStatus from './FreeQuotaStatus';
import type { SerializedEarlyBirdQuotaSnapshot } from './free-quota';

export default function EarlyBirdHome({
    displayName,
    membership,
    accessKind = 'membership',
    serverNow = new Date(0).toISOString(),
    dropIns,
    publicAccess = false,
    reactiveVisualizationAvailable = false,
    quota = null,
}: {
    displayName: string;
    membership: ListenerMembershipPresentation;
    accessKind?: 'membership' | 'free-quota';
    serverNow?: string;
    dropIns: { es: string | null; en: string | null };
    publicAccess?: boolean;
    reactiveVisualizationAvailable?: boolean;
    quota?: SerializedEarlyBirdQuotaSnapshot | null;
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
            <div className="listener-shell__frame listener-shell__frame--home">
                <header className="listener-rail">
                    <BrandLockup href={LISTENER_NAMESPACE.canonical.home} />
                    <div className="listener-rail__actions">
                        {publicAccess && (
                            <FreeQuotaStatus serverNow={serverNow} unlimited="free-for-all" compact />
                        )}
                        {!publicAccess && <details className="listener-account">
                            <summary aria-label={copy.account} title={copy.account}>
                                {displayName.slice(0, 1).toUpperCase()}
                            </summary>
                            <div className="listener-account__menu">
                                <p>{displayName}</p>
                                {accessKind === 'membership' && (
                                    <span>{membershipCopy?.title ?? copy.active}</span>
                                )}
                                {accessKind === 'membership' && membership.kind === 'founder' && membershipCopy?.detail && (
                                    <small>{membershipCopy.detail}</small>
                                )}
                                {accessKind === 'membership' && membership.kind === 'founder' && (
                                    <FreeQuotaStatus serverNow={serverNow} unlimited="membership" compact />
                                )}
                                <button type="button" onClick={signOut}>{copy.signOut}</button>
                            </div>
                        </details>}
                    </div>
                </header>
                <ListenerPlayer
                    dropIns={dropIns}
                    reactiveVisualizationAvailable={reactiveVisualizationAvailable}
                />
                {!publicAccess && accessKind === 'free-quota' && (
                    <footer className="listener-listening-status">
                        <FreeQuotaStatus snapshot={quota} serverNow={serverNow} compact showMembershipLink />
                    </footer>
                )}
            </div>
        </main>
    );
}
