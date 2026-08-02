'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StaffRole } from '@prisma/client';

import OpsHealthClient from '@/app/ops/health/OpsHealthClient';
import type { Messages } from '@/lib/i18n';
import type { UiLocale } from '@/lib/i18n';
import type { HealthLevel } from '@/lib/ops-health';

import AdmissionConsole from './AdmissionConsole';
import SessionLifecycleControl from './SessionLifecycleControl';
import SpotlightConsole, { type SpotlightSummary } from './SpotlightConsole';
import TapestryArrange from './TapestryArrange';

type EventStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
type Drawer = 'doors' | 'scene' | 'tapestry' | 'admission' | 'health';

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
        status: EventStatus;
        scheduledAt: string;
    };
    role: StaffRole;
    locale: UiLocale;
    admissionEvents: AdmissionEvent[];
    copy: Messages['ops']['cockpit'];
    lifecycleCopy: Messages['ops']['lifecycle'];
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
    locale,
    admissionEvents,
    copy,
    lifecycleCopy,
}: Props) {
    const [drawer, setDrawer] = useState<Drawer | null>(null);
    const [status, setStatus] = useState<EventStatus>(session.status);
    const [stage, setStage] = useState<SpotlightSummary>(EMPTY_STAGE);
    const [stageLoaded, setStageLoaded] = useState(false);
    const [health, setHealth] = useState<HealthLevel>('yellow');
    const returnFocusRef = useRef<HTMLButtonElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const drawerRef = useRef<HTMLElement | null>(null);

    const openDrawer = useCallback((next: Drawer, trigger: HTMLButtonElement) => {
        returnFocusRef.current = trigger;
        setDrawer(next);
    }, []);

    const closeDrawer = useCallback(() => {
        setDrawer(null);
        window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    }, []);

    useEffect(() => {
        if (!drawer) return;
        closeButtonRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDrawer();
                return;
            }
            if (event.key !== 'Tab' || !drawerRef.current) return;
            const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )].filter((element) => !element.closest('[hidden]'));
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [closeDrawer, drawer]);

    const onStageSummary = useCallback((next: SpotlightSummary) => {
        setStage(next);
        if (next.sessionStatus) setStatus(next.sessionStatus);
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
              : copy.healthPanel;

    return (
        <div className="space-y-4" data-testid="conductor-cockpit">
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
                    <span className="ml-2 truncate text-xs text-[var(--text-secondary)]">
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
                    <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--gold)]">
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
                </div>
            </header>

            <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-black/30 shadow-2xl shadow-black/20">
                <iframe
                    src={`/session/${session.id}?surface=cockpit`}
                    title={`${copy.roomTitle}: ${session.title}`}
                    allow="camera; microphone; autoplay; fullscreen"
                    className="block h-[min(68vh,760px)] min-h-[520px] w-full bg-[var(--night)] max-[420px]:min-h-[440px]"
                    data-testid="persistent-room"
                />
            </div>

            <div aria-hidden={!drawer}>
                <button
                    type="button"
                    tabIndex={drawer ? 0 : -1}
                    aria-label={`${copy.closePanel}: ${drawerTitle}`}
                    onClick={closeDrawer}
                    className={`${drawer ? 'fixed' : 'hidden'} inset-0 z-40 cursor-default bg-black/55 backdrop-blur-sm`}
                />
                <aside
                    ref={drawerRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="cockpit-drawer-title"
                    className={`${drawer ? 'fixed' : 'hidden'} inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--night)] p-4 shadow-2xl sm:p-6`}
                >
                    <div className="mb-5 flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
                        <h2 id="cockpit-drawer-title" className="font-serif text-2xl text-[var(--paper)]">
                            {drawerTitle}
                        </h2>
                        <button
                            ref={closeButtonRef}
                            type="button"
                            onClick={closeDrawer}
                            className="event-button event-button--secondary"
                        >
                            ← {copy.returnToRoom}
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
                            onSummary={onStageSummary}
                        />
                    </div>
                    <div hidden={drawer !== 'tapestry'}>
                        <TapestryArrange sessionId={session.id} />
                    </div>
                    <div hidden={drawer !== 'admission'}>
                        <AdmissionConsole role={role} events={admissionEvents} />
                    </div>
                    <div hidden={drawer !== 'health'}>
                        <OpsHealthClient
                            role={role}
                            sessionId={session.id}
                            onLevelChange={onHealthChange}
                        />
                    </div>
                </aside>
            </div>
        </div>
    );
}
