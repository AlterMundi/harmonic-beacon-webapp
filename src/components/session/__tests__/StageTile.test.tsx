// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import StageTile, { type StageVideoPublication } from '../StageTile';
import { LocaleProvider } from '@/context/LocaleContext';

function render(ui: ReactNode) {
    return rtlRender(ui, {
        wrapper: ({ children }) => <LocaleProvider initialLocale="en">{children}</LocaleProvider>,
    });
}

function fakePublication(overrides: Partial<StageVideoPublication> = {}): StageVideoPublication {
    return {
        trackSid: 'track-1',
        videoTrack: { attach: vi.fn(), detach: vi.fn() },
        setVideoDimensions: vi.fn(),
        ...overrides,
    };
}

const BASE_PROPS = {
    label: 'Julian',
    sceneRole: 'facilitator' as const,
    qualityPriority: 'high' as const,
    presence: 'connected' as const,
    presenceTone: 0 as const,
    isLocal: false,
    isSpeaking: false,
    cameraOn: true,
    micOn: true,
    connectionQuality: 'excellent' as const,
};

afterEach(cleanup);

describe('StageTile — requested simulcast quality', () => {
    it('requests 720p only for the high-priority publication', () => {
        const publication = fakePublication();
        render(<StageTile {...BASE_PROPS} qualityPriority="high" videoPublication={publication} />);
        expect(publication.setVideoDimensions).toHaveBeenCalledWith({ width: 1280, height: 720 });
    });

    it('requests 360p for a standard publication', () => {
        const publication = fakePublication();
        render(<StageTile {...BASE_PROPS} qualityPriority="standard" videoPublication={publication} />);
        expect(publication.setVideoDimensions).toHaveBeenCalledWith({ width: 640, height: 360 });
    });

    it('changes quality without replacing, attaching, or detaching the video element', () => {
        const publication = fakePublication();
        const { rerender } = render(
            <StageTile {...BASE_PROPS} qualityPriority="standard" videoPublication={publication} />,
        );
        const video = screen.getByTestId('stage-tile-video');

        rerender(<StageTile {...BASE_PROPS} qualityPriority="high" videoPublication={publication} />);

        expect(screen.getByTestId('stage-tile-video')).toBe(video);
        expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({ width: 1280, height: 720 });
        expect(publication.videoTrack?.attach).toHaveBeenCalledTimes(1);
        expect(publication.videoTrack?.detach).not.toHaveBeenCalled();
    });

    it('makes no dimension request for camera-off and reconnecting presence cards', () => {
        const cameraOff = fakePublication();
        const reconnecting = fakePublication();
        const { rerender } = render(
            <StageTile {...BASE_PROPS} cameraOn={false} qualityPriority="none" videoPublication={cameraOff} />,
        );
        expect(cameraOff.setVideoDimensions).not.toHaveBeenCalled();

        rerender(
            <StageTile {...BASE_PROPS} presence="reconnecting" qualityPriority="none" videoPublication={reconnecting} />,
        );
        expect(reconnecting.setVideoDimensions).not.toHaveBeenCalled();
        expect(screen.queryByTestId('stage-tile-video')).not.toBeInTheDocument();
    });

    it('tolerates a local publication that cannot request a remote layer', () => {
        const publication = fakePublication({ setVideoDimensions: undefined });
        expect(() => render(<StageTile {...BASE_PROPS} videoPublication={publication} />)).not.toThrow();
    });
});

describe('StageTile — video element lifecycle', () => {
    it('attaches to one element and detaches that exact element on unmount', () => {
        const publication = fakePublication();
        const { unmount } = render(<StageTile {...BASE_PROPS} videoPublication={publication} />);
        const video = screen.getByTestId('stage-tile-video');

        expect(publication.videoTrack?.attach).toHaveBeenCalledTimes(1);
        expect(publication.videoTrack?.attach).toHaveBeenCalledWith(video);
        unmount();
        expect(publication.videoTrack?.detach).toHaveBeenCalledWith(video);
    });

    it('replaces a track on the existing identity-owned video without leaving an obsolete attachment', () => {
        const original = fakePublication({ trackSid: 'old' });
        const replacement = fakePublication({ trackSid: 'new' });
        const { rerender } = render(<StageTile {...BASE_PROPS} videoPublication={original} />);
        const video = screen.getByTestId('stage-tile-video');

        rerender(<StageTile {...BASE_PROPS} videoPublication={replacement} />);

        expect(screen.getByTestId('stage-tile-video')).toBe(video);
        expect(original.videoTrack?.detach).toHaveBeenCalledTimes(1);
        expect(original.videoTrack?.detach).toHaveBeenCalledWith(video);
        expect(replacement.videoTrack?.attach).toHaveBeenCalledTimes(1);
        expect(replacement.videoTrack?.attach).toHaveBeenCalledWith(video);
    });

    it('uses a truthful connecting card only for an expected camera track', () => {
        render(<StageTile {...BASE_PROPS} videoPublication={null} />);
        expect(screen.queryByTestId('stage-tile-video')).not.toBeInTheDocument();
        expect(screen.getByText('Connecting…')).toBeInTheDocument();
    });

    it('uses dignified camera-off and reconnecting copy in the same tile geometry', () => {
        const { rerender } = render(
            <StageTile {...BASE_PROPS} cameraOn={false} qualityPriority="none" />,
        );
        const tile = screen.getByTestId('stage-tile');
        expect(screen.getByText('Present without camera')).toBeInTheDocument();

        rerender(<StageTile {...BASE_PROPS} presence="reconnecting" qualityPriority="none" />);
        expect(screen.getByTestId('stage-tile')).toBe(tile);
        expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    });

    it('never plays a local preview through the speakers', () => {
        render(<StageTile {...BASE_PROPS} isLocal videoPublication={fakePublication()} />);
        expect(screen.getByTestId('stage-tile-video')).toHaveProperty('muted', true);
        expect(screen.getByLabelText(/Julian \(you\), facilitator/)).toBeInTheDocument();
    });
});

describe('StageTile — legible role and media state', () => {
    it('makes actual name primary and role explicit without exposing an opaque identity', () => {
        render(
            <StageTile
                {...BASE_PROPS}
                label="Julian Alvarez"
                sceneRole="protagonist"
                videoPublication={fakePublication()}
            />,
        );
        const tile = screen.getByTestId('stage-tile');

        expect(tile).toHaveAttribute('aria-label', 'Julian Alvarez, protagonist');
        expect(screen.getByTitle('Julian Alvarez')).toHaveTextContent('Julian Alvarez');
        expect(screen.getByText('protagonist')).toBeInTheDocument();
        expect(tile.textContent).not.toMatch(/participant-|ticket-|@/);
    });

    it('shows microphone and camera indicators only for those explicit states', () => {
        const { rerender } = render(<StageTile {...BASE_PROPS} />);
        expect(screen.queryByRole('img', { name: 'Julian microphone muted' })).not.toBeInTheDocument();
        expect(screen.queryByRole('img', { name: 'Julian camera off' })).not.toBeInTheDocument();

        rerender(<StageTile {...BASE_PROPS} micOn={false} cameraOn={false} qualityPriority="none" />);
        expect(screen.getByRole('img', { name: 'Julian microphone muted' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Julian camera off' })).toBeInTheDocument();
    });

    it('reports connection quality and speaking without changing geometry', () => {
        const { rerender } = render(<StageTile {...BASE_PROPS} />);
        const tile = screen.getByTestId('stage-tile');
        expect(screen.getByRole('img', { name: 'Julian connection excellent' })).toBeInTheDocument();

        rerender(<StageTile {...BASE_PROPS} connectionQuality="poor" isSpeaking />);
        expect(screen.getByTestId('stage-tile')).toBe(tile);
        expect(tile).toHaveClass('stage-tile--speaking');
        expect(screen.getByRole('img', { name: 'Julian connection poor' })).toHaveAttribute('data-quality', 'poor');
    });

    it('carries the deterministic presence tone as styling metadata', () => {
        render(<StageTile {...BASE_PROPS} cameraOn={false} qualityPriority="none" presenceTone={3} />);
        expect(screen.getByTestId('stage-tile')).toHaveAttribute('data-presence-tone', '3');
    });
});
