// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import StageTile, { type StageVideoPublication } from '../StageTile';

/**
 * WS2-02: the spotlight requests the 720p layer and every auxiliary requests
 * 360p, each tile shows camera/mic mute state and connection quality, and no
 * tile leaks a video element when it changes role.
 *
 * StageTile takes structural props rather than SDK objects, so these are real
 * assertions about the rendered tile and not about a mock's shape.
 */

function fakePublication(overrides: Partial<StageVideoPublication> = {}): StageVideoPublication {
    return {
        trackSid: 'track-1',
        videoTrack: { attach: vi.fn(), detach: vi.fn() },
        setVideoDimensions: vi.fn(),
        ...overrides,
    };
}

const BASE_PROPS = {
    label: 'Facilitator',
    variant: 'spotlight' as const,
    isLocal: false,
    isSpeaking: false,
    cameraOn: true,
    micOn: true,
    connectionQuality: 'excellent' as const,
};

afterEach(cleanup);

describe('StageTile - requested simulcast layer', () => {
    it('asks the SFU for 720p in the spotlight', () => {
        const publication = fakePublication();
        render(<StageTile {...BASE_PROPS} variant="spotlight" videoPublication={publication} />);

        expect(publication.setVideoDimensions).toHaveBeenCalledWith({ width: 1280, height: 720 });
    });

    it('asks the SFU for 360p in an auxiliary slot', () => {
        const publication = fakePublication();
        render(<StageTile {...BASE_PROPS} variant="auxiliary" videoPublication={publication} />);

        expect(publication.setVideoDimensions).toHaveBeenCalledWith({ width: 640, height: 360 });
    });

    it('re-requests the layer when a tile is promoted, reusing the same video element', () => {
        const publication = fakePublication();
        const { rerender } = render(
            <StageTile {...BASE_PROPS} variant="auxiliary" videoPublication={publication} />,
        );
        const elementBefore = screen.getByTestId('stage-tile-video');

        rerender(<StageTile {...BASE_PROPS} variant="spotlight" videoPublication={publication} />);

        expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({
            width: 1280,
            height: 720,
        });
        // The whole point of promoting in place: one element, attached once.
        expect(screen.getByTestId('stage-tile-video')).toBe(elementBefore);
        expect(publication.videoTrack?.attach).toHaveBeenCalledTimes(1);
        expect(publication.videoTrack?.detach).not.toHaveBeenCalled();
    });

    it('tolerates a local publication, which cannot request a layer', () => {
        // LocalTrackPublication has no setVideoDimensions; the tile must render.
        const publication = fakePublication({ setVideoDimensions: undefined });

        expect(() =>
            render(<StageTile {...BASE_PROPS} videoPublication={publication} />),
        ).not.toThrow();
        expect(screen.getByTestId('stage-tile-video')).toBeInTheDocument();
    });
});

describe('StageTile - video element lifecycle', () => {
    it('attaches the track to exactly one element and detaches it on unmount', () => {
        const publication = fakePublication();
        const { unmount } = render(<StageTile {...BASE_PROPS} videoPublication={publication} />);

        const element = screen.getByTestId('stage-tile-video');
        expect(publication.videoTrack?.attach).toHaveBeenCalledWith(element);
        expect(publication.videoTrack?.attach).toHaveBeenCalledTimes(1);

        unmount();
        expect(publication.videoTrack?.detach).toHaveBeenCalledWith(element);
    });

    it('renders no video element for a publisher with no camera publication', () => {
        render(<StageTile {...BASE_PROPS} videoPublication={null} />);

        expect(screen.queryByTestId('stage-tile-video')).not.toBeInTheDocument();
        expect(screen.getByText('Connecting…')).toBeInTheDocument();
    });

    it('drops the video element when the camera is muted rather than freezing a frame', () => {
        const publication = fakePublication();
        const { rerender } = render(
            <StageTile {...BASE_PROPS} cameraOn videoPublication={publication} />,
        );
        const element = screen.getByTestId('stage-tile-video');

        rerender(<StageTile {...BASE_PROPS} cameraOn={false} videoPublication={publication} />);

        expect(publication.videoTrack?.detach).toHaveBeenCalledWith(element);
        expect(screen.queryByTestId('stage-tile-video')).not.toBeInTheDocument();
        expect(screen.getByText('Camera off')).toBeInTheDocument();
    });

    it('never plays a local preview back through the speakers', () => {
        render(<StageTile {...BASE_PROPS} isLocal videoPublication={fakePublication()} />);

        expect(screen.getByTestId('stage-tile-video')).toHaveProperty('muted', true);
        expect(screen.getByLabelText('Facilitator (you)')).toBeInTheDocument();
    });
});

describe('StageTile - per-tile indicators', () => {
    it('shows a mute indicator only while the microphone is muted', () => {
        const { rerender } = render(<StageTile {...BASE_PROPS} micOn />);
        expect(
            screen.queryByRole('img', { name: 'Facilitator microphone muted' }),
        ).not.toBeInTheDocument();

        rerender(<StageTile {...BASE_PROPS} micOn={false} />);
        expect(
            screen.getByRole('img', { name: 'Facilitator microphone muted' }),
        ).toBeInTheDocument();
    });

    it('shows a camera indicator only while the camera is off', () => {
        const { rerender } = render(<StageTile {...BASE_PROPS} cameraOn />);
        expect(screen.queryByRole('img', { name: 'Facilitator camera off' })).not.toBeInTheDocument();

        rerender(<StageTile {...BASE_PROPS} cameraOn={false} />);
        expect(screen.getByRole('img', { name: 'Facilitator camera off' })).toBeInTheDocument();
    });

    it('reports the participant connection quality LiveKit gives us', () => {
        const { rerender } = render(<StageTile {...BASE_PROPS} connectionQuality="excellent" />);
        expect(screen.getByRole('img', { name: 'Facilitator connection excellent' })).toBeInTheDocument();

        rerender(<StageTile {...BASE_PROPS} connectionQuality="poor" />);
        const indicator = screen.getByRole('img', { name: 'Facilitator connection poor' });
        expect(indicator).toHaveAttribute('data-quality', 'poor');
    });

    it('marks the active speaker so the audience can see who has the floor', () => {
        const { rerender } = render(<StageTile {...BASE_PROPS} isSpeaking={false} />);
        expect(screen.getByTestId('stage-tile').className).not.toMatch(/stage-tile--speaking/);

        rerender(<StageTile {...BASE_PROPS} isSpeaking />);
        expect(screen.getByTestId('stage-tile').className).toMatch(/stage-tile--speaking/);
    });

    it('labels a tile with the non-PII role word only', () => {
        render(<StageTile {...BASE_PROPS} label="Attendee" />);

        const tile = screen.getByTestId('stage-tile');
        expect(tile).toHaveAttribute('aria-label', 'Attendee');
        expect(tile.textContent).not.toMatch(/@/);
    });
});
