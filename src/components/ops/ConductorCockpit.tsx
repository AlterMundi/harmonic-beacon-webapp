'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';
import { useStaffRoomExitBridge } from '@/components/navigation/RoomExitGuard';
import type { StaffRole } from '@prisma/client';

import OpsHealthClient from '@/app/ops/health/OpsHealthClient';
import type { Messages } from '@/lib/i18n';
import type { UiLocale } from '@/lib/i18n';
import { advanceLifecycleStatus, type LifecycleStatus } from '@/lib/lifecycle-status';
import type { HealthLevel } from '@/lib/ops-health';

import AdmissionConsole from './AdmissionConsole';
import OpsTapestry from './OpsTapestry';
import SessionContributionsStaff from './SessionContributionsStaff';
import SessionContributions from '../session/SessionContributions';
import SessionLifecycleControl from './SessionLifecycleControl';
import SpotlightConsole, { type SpotlightSummary } from './SpotlightConsole';
import TapestryArrange from './TapestryArrange';

type Drawer = 'doors' | 'hands' | 'scene' | 'tapestry' | 'admission' | 'health' | 'contributions';
const ROOM_TABS = ['hands', 'scene', 'contributions'] as const;

type AdmissionEvent = {
    id: string;
    title: string;
    language: string;
    scheduledAt: string;
    attendeeCap: number;
};

type Props = {
    session: {
        id: string;
        title: string;
        status: LifecycleStatus;
        scheduledAt: string;
    };
    role: StaffRole;
    locale: UiLocale;
    admissionEvents: AdmissionEvent[];
    copy: Messages['ops']['cockpit'];
    lifecycleCopy: Messages['ops']['lifecycle'];
    spotlightCopy: Messages['ops']['spotlight'];
    healthCopy: Messages['ops']['healthPanel'];
    admissionCopy: Messages['ops']['admissionPanel'];
    contributionsCopy: Messages['ops']['contributionsPanel'];
    tapestryCopy: Messages['ops']['tapestryArrange'];
    opsTapestryCopy: Messages['ops']['opsTapestry'];
    staffRoleLabels: Messages['staffRoles'];
};

const EMPTY_STAGE: SpotlightSummary = {
    activePublishers: 0,
    maxPublishers: 6,
    handCount: 0,
    nextName: null,
    reconcileCount: 0,
    liveStateAvailable: false,
};

const HEALTH_DOT: Record<HealthLevel, string> = {
    green: 'bg-[var(--lime)]',
    yellow: 'bg-[var(--warning)]',
    red: 'bg-[var(--danger)]',
};

export default function ConductorCockpit({
    session,
    role,
    locale: initialLocale,
    admissionEvents,
}: Props) {
    const { locale, copy: messages, seedLocale } = useLocale();
    useEffect(() => { seedLocale(initialLocale); }, [initialLocale, seedLocale]);
    const { cockpit: copy, lifecycle: lifecycleCopy, spotlight: spotlightCopy,
        healthPanel: healthCopy, admissionPanel: admissionCopy,
        contributionsPanel: contributionsCopy, tapestryArrange: tapestryCopy,
        opsTapestry: opsTapestryCopy } = messages.ops;
    const staffRoleLabels = messages.staffRoles;
    const [drawer, setDrawer] = useState<Drawer | null>('hands');
    const tabsId = useId();
    const [roomHeight, setRoomHeight] = useState(700);
    const [status, setStatus] = useState<LifecycleStatus>(session.status);
    const roomFrameRef = useRef<HTMLIFrameElement>(null);
    useStaffRoomExitBridge(roomFrameRef, session.id, status === 'LIVE');
    const [stage, setStage] = useState<SpotlightSummary>(EMPTY_STAGE);
    const [stageLoaded, setStageLoaded] = useState(false);
    const [health, setHealth] = useState<HealthLevel | null>(null);
    const returnFocusRef = useRef<HTMLButtonElement | null>(null);
    const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);



    const openDrawer = useCallback((next: Drawer, trigger: HTMLButtonElement) => {
        returnFocusRef.current = trigger;
        setDrawer(next);
        window.requestAnimationFrame(() => panelHeadingRef.current?.focus());
    }, []);

    const closeDrawer = useCallback(() => {
        setDrawer(null);
        window.requestAnimationFrame(() => (returnFocusRef.current ?? document.getElementById(`${tabsId}-hands`))?.focus());
    }, [tabsId]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source !== roomFrameRef.current?.contentWindow) return;
            const data = event.data;
            if (data?.type !== 'hb-room-height' || data.sessionId !== session.id ||
                !Number.isFinite(data.height) || data.height < 1 || data.height > 20_000) return;
            setRoomHeight(Math.ceil(data.height));
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [session.id]);

    const onStageSummary = useCallback((next: SpotlightSummary) => {
        setStage(next);
        const observedStatus = next.sessionStatus;
        if (observedStatus) {
            setStatus((current) => advanceLifecycleStatus(current, observedStatus));
        }
        setStageLoaded(true);
    }, []);
    const onHealthChange = useCallback((next: HealthLevel) => setHealth(next), []);
    const doorOpen = status === 'LIVE';
    const loadingLabel = locale === 'es' ? 'Cargando…' : 'Loading…';
    const healthLabel = health === null ? loadingLabel
        : health === 'green' ? 'Normal'
        : health === 'yellow' ? (locale === 'es' ? 'Atención' : 'Attention')
        : (locale === 'es' ? 'Revisar' : 'Check');
    const needsReconciliation = stage.reconcileCount > 0 || (stageLoaded && !stage.liveStateAvailable);

    const drawerTitle = drawer === 'doors'
        ? copy.doorsPanel
        : drawer === 'hands'
          ? copy.hands
          : drawer === 'scene'
          ? copy.stage
          : drawer === 'tapestry'
            ? copy.tapestryPanel
            : drawer === 'admission'
              ? copy.admissionPanel
              : drawer === 'contributions'
                ? copy.contributionsPanel
                : copy.healthPanel;

    return (
        <div className="hb-staff-workspace space-y-4" data-testid="conductor-cockpit">
            <a className="hb-staff-jump" href={`#${tabsId}-tools`}>
                {locale === 'es' ? 'Ir al panel del equipo ↓' : 'Go to the staff panel ↓'}
            </a>
            <div className="hb-staff-room-layout">
                <iframe
                    id={`${tabsId}-room`}
                    src={`/session/${session.id}?surface=cockpit`}
                    title={`${copy.roomTitle}: ${session.title}`}
                    allow="camera; microphone; autoplay; fullscreen"
                    className="hb-staff-room-frame"
                    style={{ height: roomHeight }}
                    ref={roomFrameRef}
                    data-testid="persistent-room"
                />

            <div className="hb-staff-tools" id={`${tabsId}-tools`} tabIndex={-1} onKeyDown={event => {
                if (event.key === 'Escape' && drawer && !event.defaultPrevented) {
                    event.preventDefault();
                    closeDrawer();
                }
            }}>
                <a className="hb-staff-jump" href={`#${tabsId}-room`}>
                    {locale === 'es' ? 'Volver a mis controles ↑' : 'Back to my controls ↑'}
                </a>
                <div className="hb-staff-tool-menu">
                <div className="hb-room-tabs hb-staff-tabs" role="tablist" aria-label={locale === 'es' ? 'Panel de la sala' : 'Room panel'}>
                    {ROOM_TABS.map((tab, index) => <button key={tab} type="button" role="tab"
                        id={`${tabsId}-${tab}`} aria-controls={`${tabsId}-${tab === 'contributions' ? 'chat' : 'stage'}-panel`}
                        aria-selected={drawer === tab} tabIndex={drawer === tab || (!ROOM_TABS.some(key => key === drawer) && index === 0) ? 0 : -1}
                        data-room-tab={tab}
                        data-tool={tab === 'contributions' ? 'contributions' : undefined}
                        data-signal={tab === 'hands' ? 'hands' : tab === 'scene' ? 'stage' : undefined}
                        data-loaded={tab === 'scene' ? stageLoaded : undefined}
                        data-attention={tab === 'scene' && needsReconciliation ? 'true' : undefined}
                        aria-describedby={tab === 'scene' ? `${tabsId}-stage-status` : undefined}
                        onClick={event => { returnFocusRef.current = event.currentTarget; setDrawer(tab); }}
                        onKeyDown={event => {
                            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                            event.preventDefault();
                            const next = event.key === 'Home' ? 0 : event.key === 'End' ? ROOM_TABS.length - 1
                                : (index + (event.key === 'ArrowRight' ? 1 : -1) + ROOM_TABS.length) % ROOM_TABS.length;
                            // Tab navigation keeps focus in the tablist. The room
                            // and both tool trees retain their existing instances.
                            setDrawer(ROOM_TABS[next]);
                            const trigger = document.getElementById(`${tabsId}-${ROOM_TABS[next]}`) as HTMLButtonElement | null;
                            returnFocusRef.current = trigger;
                            trigger?.focus();
                        }}>
                        {tab === 'hands' ? <><span className="hb-staff-tab-label"><span aria-hidden="true">✋</span> {copy.hands}</span><span>{stage.handCount}</span></>
                            : tab === 'scene' ? <><span className="hb-staff-tab-label">{locale === 'es' ? 'Escena' : 'Stage'}</span><span aria-hidden="true">{needsReconciliation ? '! ' : ''}{stageLoaded ? `${stage.activePublishers}/${stage.maxPublishers}` : '…'}</span></> : 'Chat'}
                    </button>)}
                </div>
                <p id={`${tabsId}-stage-status`} className="sr-only">
                    {copy.stage}: {stageLoaded ? `${stage.activePublishers}/${stage.maxPublishers}` : loadingLabel}.
                    {needsReconciliation ? ` ${stage.reconcileCount > 0 ? copy.reconcileStage : copy.inspectStageConnection}` : ''}
                </p>
                <nav className="hb-staff-event-tools" aria-label={copy.tools}>
                    <button type="button" data-signal="door" aria-expanded={drawer === 'doors'} aria-controls={`${tabsId}-tools-panel`}
                        onClick={event => openDrawer('doors', event.currentTarget)}>
                        <span>{copy.doorsPanel}</span>
                        <span className="hb-staff-tool-status" data-state={doorOpen ? 'open' : 'closed'}>{doorOpen ? copy.open : copy.closed}</span>
                    </button>
                    <button type="button" data-signal="health" data-level={health ?? 'loading'} aria-expanded={drawer === 'health'} aria-controls={`${tabsId}-tools-panel`}
                        onClick={event => openDrawer('health', event.currentTarget)}>
                        <span>{copy.healthPanel}</span>
                        <span className="hb-staff-tool-status"><i aria-hidden="true" className={health ? HEALTH_DOT[health] : 'bg-white/30'} />{healthLabel}</span>
                    </button>
                    <button type="button" data-tool="tapestry" aria-expanded={drawer === 'tapestry'} aria-controls={`${tabsId}-tools-panel`}
                        onClick={event => openDrawer('tapestry', event.currentTarget)}>{copy.tapestryPanel}</button>
                    <button type="button" data-tool="admission" aria-expanded={drawer === 'admission'} aria-controls={`${tabsId}-tools-panel`}
                        onClick={event => openDrawer('admission', event.currentTarget)}>{copy.admissionPanel}</button>
                </nav>
                </div>
                <aside id={`${tabsId}-tools-panel`} role="region" aria-labelledby="cockpit-drawer-title" hidden={!drawer}>
                    <div className={`hb-staff-tools-heading ${ROOM_TABS.some(tab => tab === drawer) ? 'hb-staff-tools-heading--compact' : ''}`}>
                        <h2 id="cockpit-drawer-title" className={ROOM_TABS.some(tab => tab === drawer) ? 'sr-only' : undefined} tabIndex={-1} ref={panelHeadingRef}>{drawerTitle}</h2>
                        <button type="button" onClick={closeDrawer} className="event-button event-button--secondary">
                            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
                            {copy.closePanel}
                        </button>
                    </div>
                    <div hidden={drawer !== 'doors'}>
                        <SessionLifecycleControl
                            sessionId={session.id}
                            initialStatus={session.status}
                            scheduledAt={session.scheduledAt}
                            role={role}
                            locale={locale}
                            copy={lifecycleCopy}
                            observedStatus={status}
                            onStatusChange={setStatus}
                        />
                    </div>
                    <div role="tabpanel" id={`${tabsId}-stage-panel`} aria-labelledby={`${tabsId}-${drawer === 'hands' ? 'hands' : 'scene'}`} hidden={drawer !== 'hands' && drawer !== 'scene'}>
                        <SpotlightConsole
                            sessionId={session.id}
                            role={role}
                            copy={spotlightCopy}
                            staffRoles={staffRoleLabels}
                            onSummary={onStageSummary}
                            view={drawer === 'hands' ? 'hands' : 'scene'}
                        />
                    </div>
                    <div hidden={drawer !== 'tapestry'}>
                        <div className="space-y-6">
                            <OpsTapestry
                                sessionId={session.id}
                                copy={opsTapestryCopy}
                                active={drawer === 'tapestry'}
                            />
                            <TapestryArrange sessionId={session.id} copy={tapestryCopy} />
                        </div>
                    </div>
                    <div hidden={drawer !== 'admission'}>
                        <AdmissionConsole
                            role={role}
                            events={admissionEvents}
                            locale={locale}
                            copy={admissionCopy}
                        />
                    </div>
                    <div role="tabpanel" id={`${tabsId}-chat-panel`} aria-labelledby={`${tabsId}-contributions`} hidden={drawer !== 'contributions'}>
                        <SessionContributions sessionId={session.id} staff panelActive={drawer === 'contributions'} />
                        <details><summary>{locale === 'es' ? 'Vista del equipo' : 'Staff view'}</summary>
                        <SessionContributionsStaff
                            sessionId={session.id}
                            copy={contributionsCopy}
                            active={drawer === 'contributions'}
                            locale={locale}
                        />
                        </details>
                    </div>
                    <div hidden={drawer !== 'health'}>
                        <OpsHealthClient
                            role={role}
                            sessionId={session.id}
                            locale={locale}
                            copy={healthCopy}
                            staffRoles={staffRoleLabels}
                            onLevelChange={onHealthChange}
                            visualActive={drawer === 'health'}
                        />
                    </div>
                </aside>
            </div>
            </div>
        </div>
    );
}
