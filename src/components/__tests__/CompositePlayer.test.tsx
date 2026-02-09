// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CompositePlayer, { type RecordingTrack } from '../CompositePlayer';

// Mock CutDialog
vi.mock('../CutDialog', () => ({
    default: () => <div data-testid="cut-dialog">CutDialog</div>,
}));

afterEach(cleanup);

const sessionTrack: RecordingTrack = { id: 'rec-1', participantIdentity: 'provider01', category: 'SESSION' };
const beaconTrack: RecordingTrack = { id: 'rec-2', participantIdentity: 'beacon01', category: 'BEACON' };

describe('CompositePlayer', () => {
    it('renders "No recording available" when recordings empty', () => {
        render(<CompositePlayer sessionId="s1" recordings={[]} />);
        expect(screen.getByText('No recording available')).toBeInTheDocument();
    });

    it('renders play button with single track', () => {
        const { container } = render(
            <CompositePlayer sessionId="s1" recordings={[sessionTrack]} />
        );
        const playButton = container.querySelector('button');
        expect(playButton).toBeInTheDocument();
    });

    it('renders audio elements for each track', () => {
        const { container } = render(
            <CompositePlayer sessionId="s1" recordings={[sessionTrack, beaconTrack]} />
        );
        const audioElements = container.querySelectorAll('audio');
        expect(audioElements.length).toBe(2);
    });

    it('sets correct src on audio elements', () => {
        const { container } = render(
            <CompositePlayer sessionId="s1" recordings={[sessionTrack]} />
        );
        const audio = container.querySelector('audio');
        expect(audio?.getAttribute('src')).toBe('/api/sessions/s1/recording?recordingId=rec-1');
    });

    it('renders volume slider', () => {
        const { container } = render(
            <CompositePlayer sessionId="s1" recordings={[sessionTrack]} />
        );
        const rangeInputs = container.querySelectorAll('input[type="range"]');
        expect(rangeInputs.length).toBeGreaterThanOrEqual(2);
    });

    it('does NOT render crossfader labels when no beacon tracks', () => {
        const { container } = render(
            <CompositePlayer sessionId="s1" recordings={[sessionTrack]} />
        );
        // Crossfader has Beacon/Session labels — check total range inputs
        // With no beacon: seek bar + volume = 2 inputs
        const rangeInputs = container.querySelectorAll('input[type="range"]');
        expect(rangeInputs.length).toBe(2);
    });

    it('renders crossfader (3 range inputs) when beacon tracks exist', () => {
        const { container } = render(
            <CompositePlayer sessionId="s1" recordings={[sessionTrack, beaconTrack]} />
        );
        // With beacon: seek bar + volume + crossfader = 3 inputs
        const rangeInputs = container.querySelectorAll('input[type="range"]');
        expect(rangeInputs.length).toBe(3);
    });

    it('does NOT render cut controls when enableCutControls is false', () => {
        render(
            <CompositePlayer sessionId="s1" recordings={[sessionTrack]} enableCutControls={false} />
        );
        expect(screen.queryByText('Mark In')).not.toBeInTheDocument();
    });

    it('renders cut controls when enableCutControls is true', () => {
        render(
            <CompositePlayer sessionId="s1" recordings={[sessionTrack]} enableCutControls={true} />
        );
        expect(screen.getByText('Mark In')).toBeInTheDocument();
        expect(screen.getByText('Mark Out')).toBeInTheDocument();
    });

    it('shows track participant labels when multiple tracks', () => {
        render(
            <CompositePlayer sessionId="s1" recordings={[sessionTrack, beaconTrack]} />
        );
        expect(screen.getByText('provider01')).toBeInTheDocument();
        expect(screen.getByText('beacon01')).toBeInTheDocument();
    });
});
