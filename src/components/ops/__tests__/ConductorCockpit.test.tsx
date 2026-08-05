// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const callbacks = vi.hoisted(() => ({
    lifecycle: null as null | ((status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED') => void),
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
    default: ({ onStatusChange }: { onStatusChange?: typeof callbacks.lifecycle }) => {
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
    callbacks.lifecycle = null;
    callbacks.summary = null;
    callbacks.health = null;
    callbacks.healthVisualActive = null;
});

describe('ConductorCockpit', () => {
    it('keeps one room mounted while every tool opens and closes', () => {
        render(<ConductorCockpit {...props} />);
        const room = screen.getByTestId('persistent-room');
        expect(room).toHaveAttribute('src', '/session/event-1?surface=cockpit');
        expect(document.querySelectorAll('[data-signal]')).toHaveLength(6);

        for (const signal of ['door', 'hands', 'stage', 'primary', 'contributions', 'health']) {
            const trigger = document.querySelector<HTMLButtonElement>(`[data-signal="${signal}"]`);
            expect(trigger).not.toBeNull();
            if (!trigger) throw new Error(`Missing ${signal} signal`);
            fireEvent.click(trigger);
            const dialog = screen.getByRole('dialog');
            expect(dialog).toBeVisible();
            fireEvent.click(within(dialog).getByRole('button', { name: /Return to the live room/ }));
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(screen.getByTestId('persistent-room')).toBe(room);
        }
    });

    it('turns live queue and health data into glanceable signals', async () => {
        render(<ConductorCockpit {...props} />);
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
            expect(screen.getByRole('button', { name: /Hands.*2.*Alguien/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Stage.*3\/6/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Door.*Open/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Health.*red/i })).toBeInTheDocument();
            expect(screen.getByTestId('stage-occupancy').children).toHaveLength(6);
        });
    });

    it('prioritizes reconciliation over routine scene work', async () => {
        render(<ConductorCockpit {...props} />);
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
            expect(screen.getByRole('button', { name: /Next action.*Reconcile the stage/i }))
                .toBeInTheDocument();
        });
    });

    it('closes a drawer with Escape and restores focus to its trigger', async () => {
        render(<ConductorCockpit {...props} />);
        const trigger = screen.getByRole('button', { name: /Hands/i });
        fireEvent.click(trigger);
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Return to the live room/ })).toHaveFocus();
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('activates the health preview only while its drawer is visible', () => {
        render(<ConductorCockpit {...props} />);
        expect(callbacks.healthVisualActive).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: /Health.*yellow/i }));
        expect(callbacks.healthVisualActive).toBe(true);

        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {
            name: /Return to the live room/,
        }));
        expect(callbacks.healthVisualActive).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: /Hands/i }));
        expect(callbacks.healthVisualActive).toBe(false);
    });
});
