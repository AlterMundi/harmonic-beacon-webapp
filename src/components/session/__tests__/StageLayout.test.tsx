// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import StageLayout, { type StagePublisherView } from '../StageLayout';
import type { StageVideoPublication } from '../StageTile';
import { LocaleProvider } from '@/context/LocaleContext';

function render(ui: ReactNode) {
    return rtlRender(ui, {
        wrapper: ({ children }) => <LocaleProvider initialLocale="en">{children}</LocaleProvider>,
    });
}

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
        label: identity,
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
        publisher('Julian', { isFacilitator: true, grantOrder: 0 }),
        publisher('Ana', { grantOrder: 1 }),
        publisher('Beto', { grantOrder: 2 }),
        publisher('Caro', { grantOrder: 3 }),
        publisher('Dani', { grantOrder: 4 }),
        publisher('Eko', { grantOrder: 5 }),
    ];
}

function videoFor(label: string): HTMLVideoElement {
    const matching = screen
        .getAllByTestId('stage-tile')
        .find((candidate) => candidate.getAttribute('data-identity-label') === label);
    const video = matching?.querySelector('[data-testid="stage-tile-video"]');
    if (!(video instanceof HTMLVideoElement)) throw new Error(`No video for ${label}`);
    return video;
}

afterEach(cleanup);

describe('StageLayout — responsive scene grammar', () => {
    it.each([
        [1, 'solo'],
        [2, 'dyad'],
        [3, 'circle'],
        [4, 'circle'],
        [5, 'chorus'],
        [6, 'chorus'],
    ] as const)('renders %i members as a %s scene', (count, kind) => {
        render(<StageLayout publishers={fullStage().slice(0, count)} />);

        expect(screen.getByTestId('stage-layout')).toHaveAttribute('data-scene', kind);
        expect(screen.getByRole('list')).toHaveClass(`stage-scene--${kind}`);
        expect(screen.getByRole('list')).toHaveAttribute('data-member-count', String(count));
    });

    it('renders truthful empty copy instead of an empty tile grid', () => {
        render(<StageLayout publishers={[]} />);

        expect(screen.getByTestId('stage-layout')).toHaveAttribute('data-scene', 'empty');
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
        expect(screen.getByText('Waiting for the facilitator to open the stage.')).toBeInTheDocument();
    });

    it('renders at most six members and reports overflow without decoding it', () => {
        const eight = [
            ...fullStage(),
            publisher('Fran', { grantOrder: 6 }),
            publisher('Gabi', { grantOrder: 7 }),
        ];
        render(<StageLayout publishers={eight} />);

        expect(screen.getAllByTestId('stage-tile')).toHaveLength(6);
        expect(screen.getAllByTestId('stage-tile-video')).toHaveLength(6);
        expect(screen.getByTestId('stage-layout')).toHaveAttribute('data-overflow', '2');
        expect(eight[6].videoPublication?.videoTrack?.attach).not.toHaveBeenCalled();
        expect(eight[7].videoPublication?.setVideoDimensions).not.toHaveBeenCalled();
    });

    it('marks the dyad as protagonist then facilitator with equal layout classes', () => {
        render(<StageLayout publishers={fullStage().slice(0, 2)} />);

        const tiles = screen.getAllByTestId('stage-tile');
        expect(tiles.map((tile) => tile.getAttribute('data-role'))).toEqual([
            'protagonist',
            'facilitator',
        ]);
        expect(tiles.every((tile) => tile.className.includes('stage-tile'))).toBe(true);
    });
});

describe('StageLayout — media priority without DOM churn', () => {
    it('requests one 720p and five 360p layers', () => {
        const publishers = fullStage();
        render(<StageLayout publishers={publishers} activeSpeakerIdentity="Ana" />);

        const requested = publishers.map(
            (item) => (item.videoPublication?.setVideoDimensions as ReturnType<typeof vi.fn>).mock.lastCall?.[0],
        );
        expect(requested.filter((dimensions) => dimensions?.height === 720)).toHaveLength(1);
        expect(requested.filter((dimensions) => dimensions?.height === 360)).toHaveLength(5);
    });

    it('changes speaker quality without changing semantic order, videos, attach, or detach', () => {
        const publishers = fullStage();
        const { rerender } = render(
            <StageLayout publishers={publishers} activeSpeakerIdentity="Ana" />,
        );
        const orderBefore = screen.getAllByTestId('stage-tile').map((tile) => tile.getAttribute('data-identity-label'));
        const videosBefore = new Map(orderBefore.map((label) => [label, videoFor(label!)]));

        rerender(<StageLayout publishers={publishers} activeSpeakerIdentity="Dani" />);

        expect(screen.getAllByTestId('stage-tile').map((tile) => tile.getAttribute('data-identity-label'))).toEqual(orderBefore);
        for (const item of publishers) {
            expect(videoFor(item.label)).toBe(videosBefore.get(item.label));
            expect(item.videoPublication?.videoTrack?.attach).toHaveBeenCalledTimes(1);
            expect(item.videoPublication?.videoTrack?.detach).not.toHaveBeenCalled();
        }
        expect(
            screen.getAllByTestId('stage-tile').find((tile) => tile.getAttribute('data-quality-priority') === 'high'),
        ).toHaveAttribute('data-identity-label', 'Dani');
    });

    it('changes protagonist roles and order while retaining every keyed video element', () => {
        const publishers = fullStage().slice(0, 4);
        const { rerender } = render(
            <StageLayout publishers={publishers} protagonistIdentity="Ana" />,
        );
        const videosBefore = new Map(publishers.map((item) => [item.label, videoFor(item.label)]));

        rerender(<StageLayout publishers={publishers} protagonistIdentity="Caro" />);

        expect(screen.getAllByTestId('stage-tile')[0]).toHaveAttribute('data-identity-label', 'Caro');
        for (const item of publishers) {
            expect(videoFor(item.label)).toBe(videosBefore.get(item.label));
            expect(item.videoPublication?.videoTrack?.detach).not.toHaveBeenCalled();
        }
    });

    it('promotion creates and attaches only the new identity', () => {
        const publishers = fullStage();
        const initial = publishers.slice(0, 3);
        const { rerender } = render(<StageLayout publishers={initial} />);
        const existingVideos = new Map(initial.map((item) => [item.label, videoFor(item.label)]));

        rerender(<StageLayout publishers={publishers.slice(0, 4)} />);

        for (const item of initial) {
            expect(videoFor(item.label)).toBe(existingVideos.get(item.label));
            expect(item.videoPublication?.videoTrack?.attach).toHaveBeenCalledTimes(1);
            expect(item.videoPublication?.videoTrack?.detach).not.toHaveBeenCalled();
        }
        expect(publishers[3].videoPublication?.videoTrack?.attach).toHaveBeenCalledTimes(1);
        expect(screen.getAllByTestId('stage-tile-video')).toHaveLength(4);
    });

    it('demotion removes and detaches only that identity', () => {
        const publishers = fullStage().slice(0, 4);
        const { rerender } = render(<StageLayout publishers={publishers} />);
        const removed = publishers[2];

        rerender(<StageLayout publishers={publishers.filter((item) => item !== removed)} />);

        expect(removed.videoPublication?.videoTrack?.detach).toHaveBeenCalledTimes(1);
        for (const item of publishers.filter((candidate) => candidate !== removed)) {
            expect(item.videoPublication?.videoTrack?.detach).not.toHaveBeenCalled();
        }
        expect(screen.queryByLabelText(/Beto/)).not.toBeInTheDocument();
    });
});

describe('StageLayout — dignified degraded states', () => {
    it('keeps camera-off and reconnecting members in the same composition with no quality request', () => {
        const publishers = fullStage().slice(0, 4);
        publishers[1] = { ...publishers[1], cameraOn: false };
        publishers[2] = { ...publishers[2], presence: 'reconnecting' };
        render(<StageLayout publishers={publishers} />);

        expect(screen.getAllByTestId('stage-tile')).toHaveLength(4);
        expect(screen.getByLabelText(/Ana, holding the scene, Present without camera/)).toHaveAttribute('data-quality-priority', 'none');
        expect(screen.getByLabelText(/Beto, holding the scene, Reconnecting/)).toHaveAttribute('data-quality-priority', 'none');
        expect(screen.getAllByTestId('stage-tile-presence')).toHaveLength(2);
    });

    it('audio-only preserves the scene and names while rendering zero video elements', () => {
        const publishers = fullStage();
        render(<StageLayout publishers={publishers} activeSpeakerIdentity="Julian" audioOnly />);

        expect(screen.getAllByTestId('stage-tile')).toHaveLength(6);
        expect(screen.queryAllByTestId('stage-tile-video')).toHaveLength(0);
        expect(screen.getByRole('status')).toHaveTextContent('Audio-only mode');
        expect(screen.getAllByTestId('stage-tile').every((tile) => tile.getAttribute('data-quality-priority') === 'none')).toBe(true);
        for (const item of publishers) {
            expect(item.videoPublication?.videoTrack?.attach).not.toHaveBeenCalled();
        }
    });

    it('detaches on entry to audio-only and reattaches the same publications on exit', () => {
        const publishers = fullStage();
        const { rerender } = render(<StageLayout publishers={publishers} />);

        rerender(<StageLayout publishers={publishers} audioOnly />);
        for (const item of publishers) {
            expect(item.videoPublication?.videoTrack?.detach).toHaveBeenCalledTimes(1);
        }

        rerender(<StageLayout publishers={publishers} />);
        for (const item of publishers) {
            expect(item.videoPublication?.videoTrack?.attach).toHaveBeenCalledTimes(2);
        }
    });
});
