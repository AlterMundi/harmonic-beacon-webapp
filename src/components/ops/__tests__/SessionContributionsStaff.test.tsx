// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/lib/i18n';

import SessionContributionsStaff from '../SessionContributionsStaff';
import type { StaffContribution } from '../../session/useContributionsFeed';

const copy = messages.en.ops.contributionsPanel;

function staffContribution(overrides: Partial<StaffContribution> = {}): StaffContribution {
    return {
        id: 'contrib-1',
        body: 'Can we slow the breath down?',
        authorDisplayName: 'María del Valle',
        participantIdentity: 'lk-opaque-1',
        visibility: 'NAMED',
        audienceAnonymous: false,
        state: 'VISIBLE',
        createdAt: '2026-08-08T20:15:00.000Z',
        ...overrides,
    };
}

function page(
    contributions: StaffContribution[],
    envelope: { hasMore?: boolean; nextPageCursor?: string | null; resumeCursor?: string | null } = {},
) {
    return {
        contributions,
        hasMore: envelope.hasMore ?? false,
        nextPageCursor: envelope.nextPageCursor ?? null,
        resumeCursor: envelope.resumeCursor ?? null,
    };
}

function jsonResponse(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => body,
        clone() { return this; },
    } as unknown as Response;
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('SessionContributionsStaff', () => {
    it('queries the staff endpoint and renders the real author with a timestamp', async () => {
        const fetchMock = vi.fn().mockImplementation(async () =>
            jsonResponse(200, page([staffContribution()], { resumeCursor: 'cur-1' })));
        vi.stubGlobal('fetch', fetchMock);
        render(<SessionContributionsStaff sessionId="session-1" copy={copy} active locale="en" />);

        expect(await screen.findByText('María del Valle')).toBeInTheDocument();
        expect(screen.getByText('Can we slow the breath down?')).toBeInTheDocument();
        expect(fetchMock.mock.calls[0][0]).toContain('/api/ops/sessions/session-1/contributions');
    });

    it('shows the audience-anonymity badge only for audienceAnonymous items', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse(200, page([
            staffContribution({ id: 'c1', audienceAnonymous: false }),
            staffContribution({ id: 'c2', audienceAnonymous: true, visibility: 'ANONYMOUS', body: 'hidden from the room' }),
        ]))));
        render(<SessionContributionsStaff sessionId="session-1" copy={copy} active locale="en" />);

        await screen.findByText('hidden from the room');
        // Staff always see the real author, even for anonymous contributions.
        expect(screen.getAllByText('María del Valle')).toHaveLength(2);
        const badges = screen.getAllByText('Anonymous to the audience');
        expect(badges).toHaveLength(1);
    });

    it('shows the empty state and never renders a composer', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse(200, page([]))));
        render(<SessionContributionsStaff sessionId="session-1" copy={copy} active locale="en" />);

        expect(await screen.findByText('No contributions yet.')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('shows the error state with a retry that reloads the feed', async () => {
        let attempts = 0;
        const fetchMock = vi.fn().mockImplementation(async () => {
            attempts += 1;
            return attempts === 1
                ? jsonResponse(500, {})
                : jsonResponse(200, page([staffContribution()]));
        });
        vi.stubGlobal('fetch', fetchMock);
        render(<SessionContributionsStaff sessionId="session-1" copy={copy} active locale="en" />);

        expect(await screen.findByText('Could not load the conversation.')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText('María del Valle')).toBeInTheDocument();
    });
});
