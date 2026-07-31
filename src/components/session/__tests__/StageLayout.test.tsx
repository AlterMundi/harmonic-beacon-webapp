// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render as rtlRender, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

import StageLayout, { type StagePublisherView } from '../StageLayout';
import type { StageVideoPublication } from '../StageTile';
import { LocaleProvider } from '@/context/LocaleContext';

function render(ui: ReactNode) {
    return rtlRender(ui, { wrapper: ({ children }) => <LocaleProvider initialLocale="en">{children}</LocaleProvider> });
}

/**
 * WS2-02 acceptance: "every audience client renders exactly one spotlight at the
 * 720p-sized layout and at most five 360p-sized tiles", "active-speaker change
 * moves the speaker to the spotlight without duplicating or leaking video
 * elements", and audio-only "stops all video subscriptions and rendering".
 */

function publisher(
    identity: string,
    overrides: Partial<StagePublisherView> = {},
): StagePublisherView {
    const publication: StageVideoPublication = {
        trackSid: `${identity}-track`,
        videoTrack: { attach: vi.fn(), detach: vi.fn() },
        setVideoDimensions: vi.fn(),
    };
    return {
        identity,
        label: 'Attendee',
        isLocal: false,
        isFacilitator: false,
        isSpeaking: false,
        cameraOn: true,
        micOn: true,
        connectionQuality: 'excellent',
        grantOrder: 0,
        videoPublication: publication,
        ...overrides,
    };
}

function fullStage(): StagePublisherView[] {
    return [
        publisher('julian', { label: 'Facilitator', isFacilitator: true, grantOrder: 0 }),
        publisher('aux-1', { grantOrder: 1 }),
        publisher('aux-2', { grantOrder: 2 }),
        publisher('aux-3', { grantOrder: 3 }),
        publisher('aux-4', { grantOrder: 4 }),
        publisher('aux-5', { grantOrder: 5 }),
    ];
}

function tileVariants(): string[] {
    return screen.getAllByTestId('stage-tile').map((t) => t.getAttribute('data-variant') ?? '');
}

afterEach(cleanup);

describe('StageLayout - six tiles and no more', () => {
    it('renders one spotlight and five auxiliaries for a full stage', () => {
        render(<StageLayout publishers={fullStage()} activeSpeakerIdentity="julian" />);

        const variants = tileVariants();
        expect(variants.filter((v) => v === 'spotlight')).toHaveLength(1);
        expect(variants.filter((v) => v === 'auxiliary')).toHaveLength(5);
        expect(screen.getAllByTestId('stage-tile-video')).toHaveLength(6);
    });

    it('requests 720p once and 360p five times', () => {
        const publishers = fullStage();
        render(<StageLayout publishers={publishers} activeSpeakerIdentity="julian" />);

        const requested = publishers.map(
            (p) =>
                (p.videoPublication?.setVideoDimensions as ReturnType<typeof vi.fn>).mock
                    .lastCall?.[0],
        );
        expect(requested.filter((d) => d?.height === 720)).toHaveLength(1);
        expect(requested.filter((d) => d?.height === 360)).toHaveLength(5);
    });

    it('stops at six tiles when the room reports more publishers than the cap', () => {
        const publishers = [
            ...fullStage(),
            publisher('aux-6', { grantOrder: 6 }),
            publisher('aux-7', { grantOrder: 7 }),
        ];

        render(<StageLayout publishers={publishers} activeSpeakerIdentity="julian" />);

        expect(screen.getAllByTestId('stage-tile')).toHaveLength(6);
        expect(screen.getByTestId('stage-layout')).toHaveAttribute('data-overflow', '2');
    });

    it('renders no tiles, and says so, when nobody holds a stage grant', () => {
        render(<StageLayout publishers={[]} />);

        expect(screen.queryAllByTestId('stage-tile')).toHaveLength(0);
        expect(screen.getByText('Waiting for the facilitator to open the stage.')).toBeInTheDocument();
    });
});

describe('StageLayout - active speaker change', () => {
    it('moves the speaker to the spotlight without recreating any video element', () => {
        const publishers = fullStage();
        const { rerender } = render(
            <StageLayout publishers={publishers} activeSpeakerIdentity="julian" />,
        );

        const before = screen.getAllByTestId('stage-tile');
        const elementsBefore = screen.getAllByTestId('stage-tile-video');
        expect(before[0]).toHaveAttribute('data-identity-label', 'Facilitator');

        rerender(<StageLayout publishers={publishers} activeSpeakerIdentity="aux-3" />);

        const spotlit = screen
            .getAllByTestId('stage-tile')
            .find((t) => t.getAttribute('data-variant') === 'spotlight');
        expect(spotlit?.querySelector('[data-testid="stage-tile-video"]')).toBe(
            // aux-3 is index 3 of the original render order.
            elementsBefore[3],
        );

        // Still six elements, and none was torn down to make the move.
        expect(screen.getAllByTestId('stage-tile-video')).toHaveLength(6);
        for (const p of publishers) {
            expect(p.videoPublication?.videoTrack?.attach).toHaveBeenCalledTimes(1);
            expect(p.videoPublication?.videoTrack?.detach).not.toHaveBeenCalled();
        }
    });

    it('lets an operator pin hold the spotlight against the active speaker', () => {
        render(
            <StageLayout
                publishers={fullStage()}
                activeSpeakerIdentity="aux-3"
                pinnedIdentity="julian"
            />,
        );

        const spotlit = screen
            .getAllByTestId('stage-tile')
            .find((t) => t.getAttribute('data-variant') === 'spotlight');
        expect(spotlit).toHaveAttribute('data-identity-label', 'Facilitator');
    });
});

describe('StageLayout - audio-only mode', () => {
    it('renders no video element at all and says why', () => {
        const publishers = fullStage();
        render(<StageLayout publishers={publishers} activeSpeakerIdentity="julian" audioOnly />);

        expect(screen.queryAllByTestId('stage-tile-video')).toHaveLength(0);
        // Presence is preserved: six tiles, six labels, no decoders.
        expect(screen.getAllByTestId('stage-tile')).toHaveLength(6);
        expect(screen.getByRole('status').textContent).toMatch(/Audio-only mode/);
        for (const p of publishers) {
            expect(p.videoPublication?.videoTrack?.attach).not.toHaveBeenCalled();
        }
    });

    it('detaches every video element on the way into audio-only, and reattaches on the way out', () => {
        const publishers = fullStage();
        const { rerender } = render(
            <StageLayout publishers={publishers} activeSpeakerIdentity="julian" />,
        );

        rerender(
            <StageLayout publishers={publishers} activeSpeakerIdentity="julian" audioOnly />,
        );
        for (const p of publishers) {
            expect(p.videoPublication?.videoTrack?.detach).toHaveBeenCalledTimes(1);
        }

        rerender(<StageLayout publishers={publishers} activeSpeakerIdentity="julian" />);
        expect(screen.getAllByTestId('stage-tile-video')).toHaveLength(6);
        for (const p of publishers) {
            expect(p.videoPublication?.videoTrack?.attach).toHaveBeenCalledTimes(2);
        }
    });
});

describe('StageLayout - mobile shape', () => {
    it('lays out a full-width spotlight above a narrow auxiliary strip', () => {
        // Mobile must not be six equal decoders: one tile spans the whole grid
        // and the rest sit one-fifth wide beneath it (roadmap WS2-02 risk note).
        render(<StageLayout publishers={fullStage()} activeSpeakerIdentity="julian" />);

        const tiles = screen.getAllByTestId('stage-tile');
        const spotlight = tiles.find((t) => t.getAttribute('data-variant') === 'spotlight');
        const auxiliaries = tiles.filter((t) => t.getAttribute('data-variant') === 'auxiliary');

        expect(spotlight?.className).toMatch(/col-span-5/);
        for (const tile of auxiliaries) {
            expect(tile.className).toMatch(/col-span-1/);
        }
    });
});
