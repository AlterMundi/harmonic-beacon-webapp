// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Frame, Page } from '@playwright/test';
import { activateAudioAtMostOnce, RECEIVED_AUDIO } from '../../../e2e/helpers/audio-readiness';

vi.mock('@playwright/test', () => ({
    expect: Object.assign(
        (locator: {
            count?: () => number | Promise<number>;
            getAttribute?: (name: string) => string | null | Promise<string | null>;
        }) => ({
            toHaveCount: async (count: number) => expect(await locator.count?.()).toBe(count),
            toHaveAttribute: async (name: string, value: string) =>
                expect(await locator.getAttribute?.(name)).toBe(value),
        }),
        {
            poll: (read: () => Promise<boolean>) => ({
                toBe: async (value: boolean) => expect(await read()).toBe(value),
            }),
        },
    ),
}));

type Mode = 'automatic' | 'initial-cta' | 'late-cta' | 'blocked-without-cta';

function fixture(mode: Mode) {
    let ready = mode === 'automatic';
    let buttonVisible = mode === 'initial-cta';
    let sampledAbsent = false;
    let lateTransitioned = false;
    let clicks = 0;

    const audio = document.createElement('audio');
    vi.spyOn(audio, 'paused', 'get').mockReturnValue(false);

    const button = {
        isVisible: vi.fn(async () => {
            if (mode === 'late-cta' && !lateTransitioned) sampledAbsent = true;
            return buttonVisible;
        }),
        count: vi.fn(async () => {
            if (mode === 'late-cta' && sampledAbsent && !lateTransitioned) {
                lateTransitioned = true;
                buttonVisible = true;
                ready = false;
            }
            return buttonVisible ? 1 : 0;
        }),
        click: vi.fn(async () => {
            if (!buttonVisible) throw new Error('activation CTA is not visible');
            clicks += 1;
            buttonVisible = false;
            ready = true;
        }),
    };
    const state = {
        getAttribute: vi.fn(async (name: string) => {
            if (name === 'data-state') return 'connected';
            if (name === 'data-beacon-audio' || name === 'data-stage-audio') {
                return ready ? 'ready' : 'blocked';
            }
            return null;
        }),
    };
    const surface = {
        getByTestId: vi.fn(() => state),
        getByRole: vi.fn(() => button),
        locator: vi.fn((selector: string) => {
            expect(selector).toBe(RECEIVED_AUDIO);
            return { evaluateAll: async (read: (elements: Element[]) => boolean) => read([audio]) };
        }),
    };

    return {
        surface: surface as unknown as Page | Frame,
        button,
        state: () => ({ ready, buttonVisible, clicks, sampledAbsent, lateTransitioned }),
    };
}

describe('activateAudioAtMostOnce', () => {
    it('returns zero clicks for stable effective automatic readiness', async () => {
        const { surface, state } = fixture('automatic');
        await expect(activateAudioAtMostOnce(surface)).resolves.toBe(0);
        expect(state()).toMatchObject({ ready: true, buttonVisible: false, clicks: 0 });
    });

    it('clicks exactly once when the CTA is initially visible', async () => {
        const { surface, state } = fixture('initial-cta');
        await expect(activateAudioAtMostOnce(surface)).resolves.toBe(1);
        expect(state()).toMatchObject({ ready: true, buttonVisible: false, clicks: 1 });
    });

    it('uses the still-unused click when the CTA appears after the zero-click sample', async () => {
        const { surface, button, state } = fixture('late-cta');
        await expect(activateAudioAtMostOnce(surface)).resolves.toBe(1);
        expect(button.click).toHaveBeenCalledOnce();
        expect(state()).toEqual({
            ready: true,
            buttonVisible: false,
            clicks: 1,
            sampledAbsent: true,
            lateTransitioned: true,
        });
    });

    it('preserves the strict readiness failure when no CTA appears', async () => {
        const { surface, state } = fixture('blocked-without-cta');
        await expect(activateAudioAtMostOnce(surface)).rejects.toThrow();
        expect(state()).toMatchObject({ ready: false, buttonVisible: false, clicks: 0 });
    });
});
