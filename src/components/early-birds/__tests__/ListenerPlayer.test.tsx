// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@/context/LocaleContext';
import ListenerPlayer, {
    getOrCreateEarlyBirdDeviceId,
    seekNativeAudioToLiveEdge,
} from '../ListenerPlayer';

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

describe('EarlyBird Listener player', () => {
    it('keeps the device identifier stable and device-local', () => {
        const first = getOrCreateEarlyBirdDeviceId(window.localStorage);
        const second = getOrCreateEarlyBirdDeviceId(window.localStorage);
        expect(second).toBe(first);
        expect(first.length).toBeGreaterThanOrEqual(16);
    });

    it('resumes a native HLS element at the current live edge', () => {
        const audio = {
            currentTime: 12,
            seekable: {
                length: 1,
                end: () => 123.5,
            },
        } as unknown as HTMLAudioElement;
        expect(seekNativeAudioToLiveEdge(audio)).toBe(true);
        expect(audio.currentTime).toBe(123.25);
    });

    it('renders both language controls and fails closed when renders are absent', () => {
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );
        expect(screen.getByRole('button', { name: 'Listen live' })).toBeInTheDocument();
        expect(screen.getByText('Warm-up · Spanish')).toBeInTheDocument();
        expect(screen.getByText('Warm-up · English')).toBeInTheDocument();
        expect(screen.getAllByText('The approved render has not been published yet.')).toHaveLength(2);
        expect(screen.getByText('Master volume')).toBeInTheDocument();
    });
});
