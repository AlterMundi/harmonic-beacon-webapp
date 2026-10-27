// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const callbacks = vi.hoisted(() => ({
    lifecycle: null as null | ((status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED') => void),
    observedStatus: null as null | 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED',
    summary: null as null | ((summary: {
        activePublishers: number;
        maxPublishers: number;
        handCount: number;
        nextName: string | null;
        reconcileCount: number;
        liveStateAvailable: boolean;
        sessionStatus?: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
    }) => void),
    health: null as null | ((level: 'green' | 'yellow' | 'red') => void),
    healthVisualActive: null as boolean | null,
}));

vi.mock('../SessionLifecycleControl', () => ({
    default: ({
        observedStatus,
        onStatusChange,
    }: {
        observedStatus?: typeof callbacks.observedStatus;
        onStatusChange?: typeof callbacks.lifecycle;
    }) => {
        callbacks.observedStatus = observedStatus ?? null;
        callbacks.lifecycle = onStatusChange ?? null;
        return <div data-testid="lifecycle-panel">Lifecycle</div>;
    },
}));
vi.mock('../SpotlightConsole', () => ({
    default: ({ onSummary }: { onSummary?: typeof callbacks.summary }) => {
        callbacks.summary = onSummary ?? null;
        return <div data-testid="spotlight-panel">Spotlight</div>;
    },
}));
vi.mock('../TapestryArrange', () => ({
    default: () => <div data-testid="tapestry-panel">Tapestry</div>,
}));
vi.mock('../AdmissionConsole', () => ({
    default: () => <div data-testid="admission-panel">Admission</div>,
}));
vi.mock('@/components/session/SessionContributions', () => ({ default: () => <div>Staff composer</div> }));
vi.mock('../SessionContributionsStaff', () => ({
    default: () => <div data-testid="contributions-panel">Contributions</div>,
}));
vi.mock('@/app/ops/health/OpsHealthClient', () => ({
    default: ({
        onLevelChange,
        visualActive,
    }: {
        onLevelChange?: typeof callbacks.health;
        visualActive?: boolean;
    }) => {
        callbacks.health = onLevelChange ?? null;
        callbacks.healthVisualActive = visualActive ?? true;
        return <div data-testid="health-panel">Health</div>;
    },
}));

import ConductorCockpit from '../ConductorCockpit';
import { messages } from '@/lib/i18n';
import { LocaleProvider } from '@/context/LocaleContext';
import LanguageControl from '@/components/brand/LanguageControl';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const props = {
    session: {
        id: 'event-1',
        title: 'Living scene',
        status: 'SCHEDULED' as const,
        scheduledAt: '2026-08-01T18:00:00.000Z',
    },
    role: 'FACILITATOR_OP' as const,
    locale: 'en' as const,
    admissionEvents: [],
    copy: messages.en.ops.cockpit,
    lifecycleCopy: messages.en.ops.lifecycle,
    spotlightCopy: messages.en.ops.spotlight,
    healthCopy: messages.en.ops.healthPanel,
    admissionCopy: messages.en.ops.admissionPanel,
    contributionsCopy: messages.en.ops.contributionsPanel,
    tapestryCopy: messages.en.ops.tapestryArrange,
    opsTapestryCopy: messages.en.ops.opsTapestry,
    staffRoleLabels: messages.en.staffRoles,
};

afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.cookie = 'hb_locale=; Path=/; Max-Age=0';
    callbacks.lifecycle = null;
    callbacks.observedStatus = null;
    callbacks.summary = null;
    callbacks.health = null;
    callbacks.healthVisualActive = null;
});

describe('ConductorCockpit', () => {
    it('keeps chat and stage controls in adjacent keyboard-accessible tabs without replacing the room or a draft', () => {
        render(<LocaleProvider initialLocale="en"><ConductorCockpit {...props} /></LocaleProvider>);
        const room = screen.getByTestId('persistent-room');
        const hands = screen.getByRole('tab', { name: /Hands/ });
        expect(hands).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(hands, { key: 'End' });
        expect(screen.getByRole('tab', { name: 'Chat' })).toHaveFocus();
        expect(screen.getByText('Staff composer')).toBeVisible();
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Chat' }), { key: 'ArrowLeft' });
        expect(screen.getByRole('tab', { name: 'Stage' })).toHaveFocus();
        expect(screen.getByTestId('spotlight-panel')).toBeVisible();
        expect(screen.getByText('Staff composer')).not.toBeVisible();
        expect(screen.getByTestId('persistent-room')).toBe(room);
    });
    it('closes from a keyboard-selected tab and restores focus to that tab', async () => {
        render(<LocaleProvider initialLocale="en"><ConductorCockpit {...props} /></LocaleProvider>);
        fireEvent.keyDown(screen.getByRole('tab', { name: /Hands/ }), { key: 'End' });
        const chat = screen.getByRole('tab', { name: 'Chat' });
        expect(chat).toHaveFocus();
        fireEvent.keyDown(chat, { key: 'Escape' });
        await waitFor(() => expect(chat).toHaveFocus());
        expect(screen.queryByRole('region')).toBeNull();
    });

    it('updates Staff copy and an open drawer in place when language changes', () => {
        render(<LocaleProvider initialLocale="en"><LanguageControl /><ConductorCockpit {...props} /></LocaleProvider>);
        const room = screen.getByTestId('persistent-room');
        fireEvent.click(screen.getByRole('tab', { name: /Hands/i }));
        fireEvent.click(screen.getByRole('button', { name: 'ES' }));
        expect(screen.getByRole('button', { name: /Cerrar herramienta/ })).toBeVisible();
        expect(screen.getByTestId('persistent-room')).toBe(room);
        expect(room).toHaveAttribute('src', '/session/event-1?surface=cockpit');
    });
    it('keeps one room mounted while every tool opens and closes', () => {
        render(<LocaleProvider initialLocale="en"><ConductorCockpit {...props} /></LocaleProvider>);
        const room = screen.getByTestId('persistent-room');
        expect(room).toHaveAttribute('src', '/session/event-1?surface=cockpit');
        expect(document.querySelectorAll('[data-signal]')).toHaveLength(4);

        for (const signal of ['door', 'hands', 'stage', 'health']) {
            const trigger = document.querySelector<HTMLButtonElement>(`[data-signal="${signal}"]`);
            expect(trigger).not.toBeNull();
            if (!trigger) throw new Error(`Missing ${signal} signal`);
            fireEvent.click(trigger);
            const dialog = screen.getByRole('region');
            expect(dialog).toBeVisible();
            fireEvent.click(within(dialog).getByRole('button', { name: /Close tool/ }));
            expect(screen.queryByRole('region')).toBeNull();
            expect(screen.getByTestId('persistent-room')).toBe(room);
        }

        // Chat is reached from its single tab in the staff sidebar;
        // its drawer opens and closes without replacing the room as well.
        const contributionsTool = document.querySelector<HTMLButtonElement>('[data-tool="contributions"]');
        expect(contributionsTool).not.toBeNull();
        if (!contributionsTool) throw new Error('Missing contributions tool');
        fireEvent.click(contributionsTool);
        fireEvent.click(screen.getByText('Staff view'));
        expect(screen.getByTestId('contributions-panel')).toBeVisible();
        fireEvent.click(within(screen.getByRole('region')).getByRole('button', { name: /Close tool/ }));
        expect(screen.queryByRole('region')).toBeNull();
        expect(screen.getByTestId('persistent-room')).toBe(room);
    });

    it('keeps one entry per tool, with live counts and localized health in the sidebar', async () => {
        render(<LocaleProvider initialLocale="en"><ConductorCockpit {...props} /></LocaleProvider>);
        callbacks.summary?.({
            activePublishers: 3,
            maxPublishers: 6,
            handCount: 2,
            nextName: 'Alguien',
            reconcileCount: 0,
            liveStateAvailable: true,
            sessionStatus: 'LIVE',
        });
        callbacks.health?.('red');
        callbacks.lifecycle?.('LIVE');

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /Hands.*2/i })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: 'Stage' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Door.*Open/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /System health.*Check/i })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: 'Stage' })).toHaveTextContent('3/6');
            expect(screen.getAllByRole('tab', { name: /Hands/ })).toHaveLength(1);
            expect(screen.getAllByRole('button', { name: /System health/ })).toHaveLength(1);
            expect(document.querySelector('[data-signal="primary"]')).toBeNull();
        });
    });

    it('keeps shared lifecycle state monotonic across stale Spotlight snapshots', async () => {
        render(<LocaleProvider initialLocale="en"><ConductorCockpit {...props} /></LocaleProvider>);
        const summary = {
            activePublishers: 0,
            maxPublishers: 6,
            handCount: 0,
            nextName: null,
            reconcileCount: 0,
            liveStateAvailable: true,
        };

        callbacks.lifecycle?.('LIVE');
        await waitFor(() => {
            expect(callbacks.observedStatus).toBe('LIVE');
            expect(screen.getByRole('button', { name: /Door.*Open/i })).toBeInTheDocument();
        });

        callbacks.summary?.({ ...summary, sessionStatus: 'SCHEDULED' });
        await waitFor(() => {
            expect(callbacks.observedStatus).toBe('LIVE');
            expect(screen.getByRole('button', { name: /Door.*Open/i })).toBeInTheDocument();
        });

        callbacks.lifecycle?.('ENDED');
        await waitFor(() => {
            expect(callbacks.observedStatus).toBe('ENDED');
            expect(screen.getByRole('button', { name: /Door.*Closed/i })).toBeInTheDocument();
        });

        callbacks.summary?.({ ...summary, sessionStatus: 'LIVE' });
        await waitFor(() => {
            expect(callbacks.observedStatus).toBe('ENDED');
            expect(screen.getByRole('button', { name: /Door.*Closed/i })).toBeInTheDocument();
        });
    });

    it('marks the single stage tab when reconciliation needs attention', async () => {
        render(<LocaleProvider initialLocale="en"><ConductorCockpit {...props} /></LocaleProvider>);
        callbacks.summary?.({
            activePublishers: 2,
            maxPublishers: 6,
            handCount: 0,
            nextName: null,
            reconcileCount: 1,
            liveStateAvailable: true,
            sessionStatus: 'LIVE',
        });

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: 'Stage' })).toHaveAttribute('data-attention', 'true');
            expect(screen.getByRole('tab', { name: 'Stage' })).toHaveAccessibleDescription(/Reconcile the stage/);
        });
    });

    it('closes the focused tools region with Escape and restores focus to its trigger', async () => {
        render(<LocaleProvider initialLocale="en"><ConductorCockpit {...props} /></LocaleProvider>);
        const trigger = screen.getByRole('tab', { name: /Hands/i });
        fireEvent.click(trigger);
        const panel = screen.getByRole('region');
        fireEvent.keyDown(panel, { key: 'Escape' });
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(screen.queryByRole('region')).toBeNull();
    });

    it('activates the health preview only while its drawer is visible', () => {
        render(<LocaleProvider initialLocale="en"><ConductorCockpit {...props} /></LocaleProvider>);
        expect(callbacks.healthVisualActive).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: /System health.*Loading/i }));
        expect(callbacks.healthVisualActive).toBe(true);

        fireEvent.click(within(screen.getByRole('region')).getByRole('button', {
            name: /Close tool/,
        }));
        expect(callbacks.healthVisualActive).toBe(false);

        fireEvent.click(screen.getByRole('tab', { name: /Hands/i }));
        expect(callbacks.healthVisualActive).toBe(false);
    });
});
