// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReactiveCampfireCanvas } from '../ReactiveCampfireCanvas';
import { ReactiveCampfireTuningPanel } from '../ReactiveCampfireTuningPanel';
import { DEFAULT_REACTIVE_CAMPFIRE_SETTINGS } from '../settings';

describe('reactive campfire components', () => {
    beforeEach(() => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
            .mockReturnValue({} as CanvasRenderingContext2D);
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: vi.fn(() => ({ matches: true })),
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('keeps the canvas decorative and accepts a subscription-neutral frame prop', () => {
        render(<ReactiveCampfireCanvas frame={null} mode="stopped" />);

        expect(screen.getByTestId('reactive-campfire-canvas')).toHaveAttribute('aria-hidden', 'true');
        expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it('accepts imperative frames without requiring React state updates', () => {
        const unsubscribe = vi.fn();
        const subscribeFrames = vi.fn(() => unsubscribe);
        const { unmount } = render(
            <ReactiveCampfireCanvas mode="active" subscribeFrames={subscribeFrames} />,
        );

        expect(subscribeFrames).toHaveBeenCalledTimes(1);
        expect(subscribeFrames).toHaveBeenCalledWith(expect.any(Function));
        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('fails soft when the decorative canvas cannot initialize', () => {
        const onRendererError = vi.fn();
        vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => {
            throw new Error('canvas unavailable');
        });

        expect(() => render(
            <ReactiveCampfireCanvas
                frame={null}
                mode="active"
                onRendererError={onRendererError}
            />,
        )).not.toThrow();
        expect(onRendererError).toHaveBeenCalledWith(expect.objectContaining({
            message: 'canvas unavailable',
        }));
    });

    it('requests direct fallback once when the browser returns no 2D context', () => {
        const onRendererError = vi.fn();
        vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);

        const { rerender } = render(
            <ReactiveCampfireCanvas
                frame={null}
                mode="active"
                onRendererError={onRendererError}
            />,
        );
        rerender(
            <ReactiveCampfireCanvas
                frame={null}
                mode="stopped"
                onRendererError={onRendererError}
            />,
        );

        expect(onRendererError).toHaveBeenCalledTimes(1);
        expect(onRendererError).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Canvas 2D context unavailable',
        }));
        expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('does not expose the laboratory when its staging feature gate is off', () => {
        const { rerender } = render(
            <ReactiveCampfireTuningPanel
                enabled={false}
                settings={{ ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS }}
                onChange={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('reactive-campfire-tuning-panel')).not.toBeInTheDocument();

        rerender(
            <ReactiveCampfireTuningPanel
                enabled
                settings={{ ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS }}
                onChange={vi.fn()}
            />,
        );
        expect(screen.getByTestId('reactive-campfire-tuning-panel')).toBeInTheDocument();
    });

    it('updates validated settings without touching any audio API', () => {
        const onChange = vi.fn();
        render(
            <ReactiveCampfireTuningPanel
                enabled
                settings={{ ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS }}
                onChange={onChange}
            />,
        );

        fireEvent.change(screen.getByLabelText(/Variation sensitivity/i), { target: { value: '1.5' } });
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sensitivity: 1.5 }));
        expect(window.AudioContext).toBeUndefined();
    });

    it('offers both renderers, both FFT sizes and the harmonic cut control', () => {
        const onChange = vi.fn();
        render(
            <ReactiveCampfireTuningPanel
                enabled
                settings={{ ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS }}
                onChange={onChange}
            />,
        );

        const fft = screen.getByLabelText('FFT size');
        expect(fft).toHaveTextContent('8192 · lighter');
        expect(fft).toHaveTextContent('16384 · more detail');
        expect(screen.getByLabelText('Visualization')).toHaveTextContent('Toroid meridians');
        fireEvent.change(screen.getByLabelText('Visualization'), {
            target: { value: 'horizon-flow' },
        });
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
            visualizationMode: 'horizon-flow',
        }));
        expect(screen.getByText(/H16 · 646.4 Hz/)).toBeInTheDocument();
    });
});
