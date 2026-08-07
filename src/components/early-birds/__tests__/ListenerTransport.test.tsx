// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LocaleProvider } from '@/context/LocaleContext';

vi.mock('hls.js', () => {
    class TestHls {
        static Events = { ERROR: 'error' };
        static isSupported = () => true;
        liveSyncPosition: number | null = null;
        on() {}
        loadSource() {}
        attachMedia() {}
        destroy() {}
    }
    return { default: TestHls };
});

import ListenerPlayer from '../ListenerPlayer';

const GRANT = {
    leaseId: '00000000-0000-4000-8000-000000000003',
    leaseExpiresAt: '2099-08-06T12:03:00.000Z',
    stream: {
        manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
        expiresAt: '2099-08-06T12:03:00.000Z',
    },
};

function prepareMedia() {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(GRANT), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    })));
    return { play, pause };
}

afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('EarlyBird unified playlist transport', () => {
    it('defaults to the English intro and exposes two play choices, Pause and Stop', async () => {
        prepareMedia();
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: '/api/drop-ins/en' }} />
            </LocaleProvider>,
        );

        expect(screen.getByRole('combobox', { name: 'Intro before the Beacon' })).toHaveValue('en');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Play with intro' })).toBeEnabled());
        expect(screen.getByRole('button', { name: 'Play with intro' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Play · Beacon only' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Play · Beacon only' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    });

    it('pauses and resumes the intro at the same position', async () => {
        const { play, pause } = prepareMedia();
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: '/api/drop-ins/en' }} />
            </LocaleProvider>,
        );
        const intro = screen.getByLabelText('Warm-up · English') as HTMLAudioElement;
        await waitFor(() => expect(screen.getByRole('button', { name: 'Play with intro' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Play with intro' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled());
        intro.currentTime = 42;
        pause.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

        expect(pause.mock.instances).toContain(intro);
        expect(intro.currentTime).toBe(42);
        expect(screen.getByText('Paused')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Resume' })).toHaveAttribute('aria-pressed', 'true');

        play.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled());
        expect(play.mock.instances).toContain(intro);
        expect(intro.currentTime).toBe(42);
    });

    it('pauses and resumes the Beacon without restarting the transport', async () => {
        const { play, pause } = prepareMedia();
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: '/api/drop-ins/en' }} />
            </LocaleProvider>,
        );
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        await waitFor(() => expect(screen.getByRole('button', { name: 'Play · Beacon only' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Play · Beacon only' }));
        Object.defineProperty(live, 'paused', { value: false, configurable: true });
        fireEvent.playing(live);
        live.currentTime = 73;
        pause.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

        expect(pause.mock.instances).toContain(live);
        expect(live.currentTime).toBe(73);
        expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();

        play.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled());
        expect(play.mock.instances).toContain(live);
        expect(live.currentTime).toBe(73);
    });

    it('keeps the intro timeline and master volume inside Beacon 24/7 without a separate drop-ins section', async () => {
        prepareMedia();
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: '/api/drop-ins/en' }} />
            </LocaleProvider>,
        );

        const beaconPanel = screen.getByRole('heading', { name: 'Beacon 24/7' }).closest('section');
        expect(beaconPanel).not.toBeNull();
        expect(beaconPanel).toContainElement(screen.getByRole('heading', { name: 'Warm-up · English' }));
        expect(beaconPanel).toContainElement(screen.getByRole('slider', { name: 'Intro before the Beacon: Warm-up · English' }));
        expect(beaconPanel).toContainElement(screen.getByRole('slider', { name: 'Master volume' }));
        expect(screen.queryByRole('heading', { name: 'Private drop-ins' })).not.toBeInTheDocument();
    });

    it('plays the intro from the beginning while the Beacon is fully stopped', async () => {
        const { play, pause } = prepareMedia();
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: '/api/drop-ins/en' }} />
            </LocaleProvider>,
        );
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        const intro = screen.getByLabelText('Warm-up · English') as HTMLAudioElement;
        intro.currentTime = 42;
        await waitFor(() => expect(screen.getByRole('button', { name: 'Play with intro' })).toBeEnabled());
        pause.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Play with intro' }));

        await waitFor(() => expect(screen.getByText('Playing intro · Beacon follows')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Play with intro' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Play · Beacon only' })).toHaveAttribute('aria-pressed', 'false');
        expect(intro.currentTime).toBe(0);
        expect(play.mock.instances).toContain(intro);
        expect(play.mock.instances).not.toContain(live);
        expect(pause.mock.instances).toContain(live);
    });

    it('starts the Beacon at intro end and fades it in', async () => {
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const { play } = prepareMedia();
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: '/api/drop-ins/en' }} />
            </LocaleProvider>,
        );
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        const intro = screen.getByLabelText('Warm-up · English') as HTMLAudioElement;
        await waitFor(() => expect(screen.getByRole('button', { name: 'Play with intro' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Play with intro' }));
        await waitFor(() => expect(screen.getByText('Playing intro · Beacon follows')).toBeInTheDocument());

        Object.defineProperty(intro, 'ended', { value: true, configurable: true });
        fireEvent.ended(intro);
        await waitFor(() => expect(play.mock.instances).toContain(live));
        expect(live.muted).toBe(true);
        Object.defineProperty(live, 'paused', { value: false, configurable: true });
        fireEvent.playing(live);
        expect(live.muted).toBe(false);
        expect(live.volume).toBe(0);
        frames.shift()?.(3_000);
        expect(live.volume).toBeCloseTo(1);
        expect(screen.getByText('Playing Beacon 24/7')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Play with intro' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Play · Beacon only' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('plays Beacon-only with a fade-in and stops it over a short fade-out', async () => {
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const { pause } = prepareMedia();
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: '/api/drop-ins/en' }} />
            </LocaleProvider>,
        );
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        await waitFor(() => expect(screen.getByRole('button', { name: 'Play · Beacon only' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Play · Beacon only' }));
        Object.defineProperty(live, 'paused', { value: false, configurable: true });
        fireEvent.playing(live);
        frames.shift()?.(3_000);
        expect(live.volume).toBeCloseTo(1);
        expect(screen.getByRole('button', { name: 'Play · Beacon only' })).toHaveAttribute('aria-pressed', 'true');
        pause.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        expect(screen.getByRole('button', { name: 'Play with intro' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Play · Beacon only' })).toHaveAttribute('aria-pressed', 'false');
        expect(pause.mock.instances).not.toContain(live);
        act(() => frames.shift()?.(650));
        expect(pause.mock.instances).toContain(live);
        expect(screen.getByText('Stopped')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Play with intro' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Play · Beacon only' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('stops an already playing Beacon before the selected intro starts', async () => {
        const { play, pause } = prepareMedia();
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: '/api/drop-ins/en' }} />
            </LocaleProvider>,
        );
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        const intro = screen.getByLabelText('Warm-up · English') as HTMLAudioElement;
        await waitFor(() => expect(screen.getByRole('button', { name: 'Play · Beacon only' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Play · Beacon only' }));
        await waitFor(() => expect(screen.getByText('Playing Beacon 24/7')).toBeInTheDocument());
        pause.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Play with intro' }));

        await waitFor(() => expect(screen.getByText('Playing intro · Beacon follows')).toBeInTheDocument());
        expect(pause.mock.instances).toContain(live);
        expect(play.mock.instances.at(-1)).toBe(intro);
    });
});
