import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider, useLocale } from '../../src/context/LocaleContext';
import { LiveNavigationAccountMenu } from '../../src/components/brand/LiveNavigationAccountMenu';
import { GlobalNavigation } from '../../src/components/brand/GlobalNavigation';
import LanguageControl from '../../src/components/brand/LanguageControl';
import ConductorCockpit from '../../src/components/ops/ConductorCockpit';
import { RoomExitProvider, useRoomExit } from '../../src/components/navigation/RoomExitGuard';
import { messages } from '../../src/lib/i18n';

function RoomProbe() {
    const { locale } = useLocale();
    const [active, setActive] = useState(true);
    const requestExit = useRoomExit(active);
    const [value, setValue] = useState('draft');
    const media = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        // A real, capture-free browser MediaStream remains attached across UI
        // changes. This is not a claim of real LiveKit/audio qualification.
        const canvas = document.createElement('canvas');
        const stream = canvas.captureStream?.(1);
        if (media.current && stream) media.current.srcObject = stream;
        // Emit an initial frame: an untouched canvas leaves the video waiting
        // for data and can keep the document's load/history commit pending.
        canvas.getContext('2d')?.fillRect(0, 0, 1, 1);
        return () => stream?.getTracks().forEach(track => track.stop());
    }, []);
    return <><output aria-label="Room locale">{locale}</output>
        <input aria-label="Room draft" value={value} onChange={event => setValue(event.target.value)} />
        <video ref={media} autoPlay muted /><LanguageControl />
        <button onClick={event => { event.currentTarget.focus(); requestExit(() => location.assign('/away')); }}>Exit room</button>
        <button onClick={() => setActive(false)}>End room</button><button onClick={() => setActive(true)}>Start room</button>
        <NavigationLinks />
    </>;
}
function NavigationLinks() {
    const shadow = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const root = shadow.current!.attachShadow({ mode: 'open' });
        const link = document.createElement('a'); link.href = '/away'; link.textContent = 'Shadow exit'; root.append(link);
    }, []);
    return <><a href="/away">Global exit</a><a href="#panel">Local panel</a><a href="/away" target="_blank">New tab</a><div ref={shadow} /></>;
}
function PinnedNavigation() {
    useEffect(() => {
        const script = document.createElement('script'); script.src = '/assets/hb-global-nav.js';
        document.body.append(script);
        return () => script.remove();
    }, []);
    return <GlobalNavigation active="events" locale="en" allowRemoteEnhancement={false} accountAvailable accountSignedIn accountMenu={<LiveNavigationAccountMenu displayName="Test staff" staffRoleLabel="Operator" accountHref="https://account.harmonicbeacon.com/account" accountIssuer="https://account.harmonicbeacon.com" locale="en" />} />;
}
function Fixture() {
    const child = location.pathname.startsWith('/session/');
    return <LocaleProvider initialLocale="en"><RoomExitProvider>
        {new URLSearchParams(location.search).has('real-navigation') && <PinnedNavigation />}
        {child ? <RoomProbe /> : <><NavigationLinks /><LanguageControl /><ConductorCockpit
            session={{ id: 'event-1', title: 'Fixture event', status: 'LIVE', scheduledAt: '2026-08-01T18:00:00Z' }}
            role="FACILITATOR_OP" locale="en" admissionEvents={[]}
            copy={messages.en.ops.cockpit} lifecycleCopy={messages.en.ops.lifecycle}
            spotlightCopy={messages.en.ops.spotlight} healthCopy={messages.en.ops.healthPanel}
            admissionCopy={messages.en.ops.admissionPanel} contributionsCopy={messages.en.ops.contributionsPanel}
            tapestryCopy={messages.en.ops.tapestryArrange} opsTapestryCopy={messages.en.ops.opsTapestry}
            staffRoleLabels={messages.en.staffRoles}
        /></>}
    </RoomExitProvider></LocaleProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
