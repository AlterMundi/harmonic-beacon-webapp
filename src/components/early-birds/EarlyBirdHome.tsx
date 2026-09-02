'use client';

import { useEffect } from 'react';

import { useLocale } from '@/context/LocaleContext';
import { clearListenerOAuthAttempt } from '@/lib/early-birds/auth-client';
import { earlyBirdCopy, earlyBirdHomeCopy } from '@/lib/early-birds/copy';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

import BeaconField from './BeaconField';
import FreeQuotaStatus from './FreeQuotaStatus';
import type { SerializedEarlyBirdQuotaSnapshot } from './free-quota';
import ListenerPlayer from './ListenerPlayer';

export default function EarlyBirdHome({
    accessKind = 'membership',
    serverNow = new Date(0).toISOString(),
    dropIns,
    publicAccess = false,
    reactiveVisualizationAvailable = false,
    reactiveFieldLabAvailable = false,
    quota = null,
}: {
    accessKind?: 'membership' | 'free-quota';
    serverNow?: string;
    dropIns: { es: string | null; en: string | null };
    publicAccess?: boolean;
    reactiveVisualizationAvailable?: boolean;
    reactiveFieldLabAvailable?: boolean;
    quota?: SerializedEarlyBirdQuotaSnapshot | null;
}) {
    const { locale } = useLocale();
    const copy = earlyBirdHomeCopy[locale];
    const membershipCopy = earlyBirdCopy[locale];

    useEffect(() => clearListenerOAuthAttempt(), []);

    return (
        <main className="listener-shell">
            <div className="listener-shell__frame listener-shell__frame--home">
                <header className="listener-rail">
                    <div className="listener-rail__actions">
                        {publicAccess ? (
                            <FreeQuotaStatus serverNow={serverNow} unlimited="free-for-all" compact />
                        ) : (
                            <a
                                className="listener-membership-entry"
                                href={LISTENER_NAMESPACE.canonical.membership}
                            >
                                {accessKind === 'free-quota'
                                    ? membershipCopy.membershipSubscribeAction
                                    : membershipCopy.membershipManageAction}
                            </a>
                        )}
                    </div>
                </header>
                <div className="listener-static-field" data-testid="listener-static-field">
                    <BeaconField phase="ready" />
                </div>
                <section className="listener-altar" aria-labelledby="listener-heading">
                    <div className="listener-altar__heading" aria-hidden="true">
                        <p>{copy.eyebrow}</p>
                        <strong>{copy.heading}</strong>
                    </div>
                    <ListenerPlayer
                        dropIns={dropIns}
                        reactiveVisualizationAvailable={reactiveVisualizationAvailable}
                        reactiveVisualizationInitiallyEnabled={false}
                        reactiveFieldLabAvailable={reactiveFieldLabAvailable}
                    />
                    {!publicAccess && accessKind === 'free-quota' && (
                        <footer className="listener-listening-status">
                            <FreeQuotaStatus
                                snapshot={quota}
                                serverNow={serverNow}
                                compact
                            />
                        </footer>
                    )}
                </section>
            </div>
        </main>
    );
}
