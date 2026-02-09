// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import AudioVisualizer from '../AudioVisualizer';

describe('AudioVisualizer', () => {
    it('renders default 5 bars', () => {
        const { container } = render(<AudioVisualizer />);
        const bars = container.querySelectorAll('.audio-bar');
        expect(bars.length).toBe(5);
    });

    it('renders custom bar count', () => {
        const { container } = render(<AudioVisualizer bars={8} />);
        const bars = container.querySelectorAll('.audio-bar');
        expect(bars.length).toBe(8);
    });

    it('sets animationPlayState to "running" when isPlaying=true', () => {
        const { container } = render(<AudioVisualizer isPlaying={true} />);
        const bar = container.querySelector('.audio-bar') as HTMLElement;
        expect(bar.style.animationPlayState).toBe('running');
    });

    it('sets animationPlayState to "paused" when isPlaying=false', () => {
        const { container } = render(<AudioVisualizer isPlaying={false} />);
        const bar = container.querySelector('.audio-bar') as HTMLElement;
        expect(bar.style.animationPlayState).toBe('paused');
    });

    it('applies custom className', () => {
        const { container } = render(<AudioVisualizer className="my-viz" />);
        const wrapper = container.querySelector('.audio-bars');
        expect(wrapper?.className).toContain('my-viz');
    });

    it('sets staggered animation delays', () => {
        const { container } = render(<AudioVisualizer bars={3} />);
        const bars = container.querySelectorAll('.audio-bar');
        expect((bars[0] as HTMLElement).style.animationDelay).toBe('0s');
        expect((bars[1] as HTMLElement).style.animationDelay).toBe('0.1s');
        expect((bars[2] as HTMLElement).style.animationDelay).toBe('0.2s');
    });
});
