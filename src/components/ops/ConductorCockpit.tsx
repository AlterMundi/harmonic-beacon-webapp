'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

type Drawer = 'doors' | 'scene' | 'tapestry' | 'admission' | 'health' | 'contributions';

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
    const [drawer, setDrawer] = useState<Drawer | null>('scene');
    const [roomHeight, setRoomHeight] = useState(700);
    const [status, setStatus] = useState<LifecycleStatus>(session.status);
    const roomFrameRef = useRef<HTMLIFrameElement>(null);
    useStaffRoomExitBridge(roomFrameRef, session.id, status === 'LIVE');
    const [stage, setStage] = useState<SpotlightSummary>(EMPTY_STAGE);
    const [stageLoaded, setStageLoaded] = useState(false);
    const [health, setHealth] = useState<HealthLevel>('yellow');
    const returnFocusRef = useRef<HTMLButtonElement | null>(null);
    const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);



    const openDrawer = useCallback((next: Drawer, trigger: HTMLButtonElement) => {
        returnFocusRef.current = trigger;
        setDrawer(next);
        window.requestAnimationFrame(() => panelHeadingRef.current?.focus());
    }, []);

    const closeDrawer = useCallback(() => {
        setDrawer(null);
        window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    }, []);

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
    const needsReconciliation = stage.reconcileCount > 0 || (stageLoaded && !stage.liveStateAvailable);
    const primaryDrawer: Drawer = needsReconciliation
        ? 'scene'
        : health === 'red'
          ? 'health'
          : !doorOpen
            ? 'doors'
            : 'scene';
    const primaryAction = stage.reconcileCount > 0
        ? copy.reconcileStage
        : stageLoaded && !stage.liveStateAvailable
          ? copy.inspectStageConnection
          : health === 'red'
            ? copy.inspectHealth
            : !doorOpen
              ? copy.openDoors
              : stage.handCount > 0
                ? copy.manageHands
                : copy.inspectStage;

    const drawerTitle = drawer === 'doors'
        ? copy.doorsPanel
        : drawer === 'scene'
          ? copy.handsPanel
          : drawer === 'tapestry'
            ? copy.tapestryPanel
            : drawer === 'admission'
              ? copy.admissionPanel
              : drawer === 'contributions'
                ? copy.contributionsPanel
                : copy.healthPanel;

    return (
        <div className="hb-staff-workspace space-y-4" data-testid="conductor-cockpit">
            <nav
                aria-label={copy.tools}
                className="sticky top-0 z-30 grid grid-cols-3 gap-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--forest)]/95 p-1 shadow-xl backdrop-blur sm:gap-2 sm:p-2 md:grid-cols-5"
            >
                <button
                    type="button"
                    className="operational-panel min-h-16 text-left"
                    onClick={(event) => openDrawer('doors', event.currentTarget)}
                    data-signal="door"
                >
                    <span className="block text-xs text-[var(--text-secondary)]">{copy.door}</span>
                    <strong className={doorOpen ? 'text-[var(--lime)]' : 'text-[var(--gold)]'}>
                        {doorOpen ? copy.open : copy.closed}
                    </strong>
                </button>
                <button
                    type="button"
                    className="operational-panel min-h-16 text-left"
                    onClick={(event) => openDrawer('scene', event.currentTarget)}
                    data-signal="hands"
                >
                    <span className="block text-xs text-[var(--text-secondary)]">{copy.hands}</span>
                    <strong className={stage.handCount > 0 ? 'text-[var(--pink)]' : 'text-[var(--cream)]'}>
                        {stage.handCount}
                    </strong>
                    <span className="mt-1 block break-words text-xs leading-4 text-[var(--text-secondary)]">
                        {stage.nextName ? `${copy.next}: ${stage.nextName}` : copy.noHands}
                    </span>
                </button>
                <button
                    type="button"
                    className="operational-panel min-h-16 text-left"
                    onClick={(event) => openDrawer('scene', event.currentTarget)}
                    data-signal="stage"
                    data-loaded={stageLoaded}
                >
                    <span className="block text-xs text-[var(--text-secondary)]">{copy.stage}</span>
                    <strong className={needsReconciliation ? 'text-[var(--danger)]' : 'text-[var(--cream)]'}>
                        {stage.activePublishers}/{stage.maxPublishers}
                    </strong>
                    <span className="mt-1 flex gap-1" aria-hidden="true" data-testid="stage-occupancy">
                        {Array.from({ length: stage.maxPublishers }, (_, index) => (
                            <span
                                key={index}
                                className={`h-1.5 flex-1 rounded-full ${index < stage.activePublishers ? 'bg-[var(--cyan)]' : 'bg-white/10'}`}
                            />
                        ))}
                    </span>
                </button>
                <button
                    type="button"
                    className="operational-panel col-span-2 min-h-16 text-left md:col-span-1"
                    onClick={(event) => openDrawer(primaryDrawer, event.currentTarget)}
                    data-signal="primary"
                >
                    <span className="block text-xs text-[var(--text-secondary)]">{copy.primary}</span>
                    <strong className="text-sm text-[var(--paper)]">
                        {primaryAction}
                    </strong>
                </button>
                <button
                    type="button"
                    className="operational-panel min-h-16 text-left"
                    onClick={(event) => openDrawer('health', event.currentTarget)}
                    data-signal="health"
                >
                    <span className="block text-xs text-[var(--text-secondary)]">{copy.healthSignal}</span>
                    <span className={`mt-1 inline-block h-3 w-3 rounded-full ${HEALTH_DOT[health]}`} />
                    <strong className="ml-2 uppercase text-[var(--cream)]">{health}</strong>
                </button>
            </nav>

            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-xs font-mono uppercase tracking-[0.12em] text-[var(--gold)]">
                        {copy.roomTitle}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">{copy.roomHint}</p>
                </div>
                <div className="flex flex-wrap gap-2" aria-label={copy.tools}>
                    <button
                        type="button"
                        className="event-button event-button--secondary"
                        data-tool="tapestry"
                        onClick={(event) => openDrawer('tapestry', event.currentTarget)}
                    >
                        {copy.tapestryPanel}
                    </button>
                    <button
                        type="button"
                        className="event-button event-button--secondary"
                        data-tool="admission"
                        onClick={(event) => openDrawer('admission', event.currentTarget)}
                    >
                        {copy.admissionPanel}
                    </button>
                    <button
                        type="button"
                        className="event-button event-button--secondary"
                        data-tool="contributions"
                        onClick={(event) => openDrawer('contributions', event.currentTarget)}
                    >
                        {copy.contributionsPanel}
                    </button>
                </div>
            </header>

            <div className="hb-staff-room-layout">
                <iframe
                    src={`/session/${session.id}?surface=cockpit`}
                    title={`${copy.roomTitle}: ${session.title}`}
                    allow="camera; microphone; autoplay; fullscreen"
                    className="hb-staff-room-frame"
                    style={{ height: roomHeight }}
                    ref={roomFrameRef}
                    data-testid="persistent-room"
                />

            <div className="hb-staff-tools" hidden={!drawer}>
                <aside role="region" aria-labelledby="cockpit-drawer-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); } }}>
                    <div className="hb-staff-tools-heading">
                        <h2 id="cockpit-drawer-title" tabIndex={-1} ref={panelHeadingRef}>{drawerTitle}</h2>
                        <button type="button" onClick={closeDrawer} className="event-button event-button--secondary">
                            {copy.returnToRoom}
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
                    <div hidden={drawer !== 'scene'}>
                        <SpotlightConsole
                            sessionId={session.id}
                            role={role}
                            copy={spotlightCopy}
                            staffRoles={staffRoleLabels}
                            onSummary={onStageSummary}
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
                    <div hidden={drawer !== 'contributions'}>
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
