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

function renderPlayer(dropIns = { es: null, en: '/api/drop-ins/en' }) {
    return render(
        <LocaleProvider initialLocale="en">
            <ListenerPlayer dropIns={dropIns} />
        </LocaleProvider>,
    );
}

async function waitForListen() {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
}

async function chooseBeaconOnly() {
    await waitForListen();
    fireEvent.click(screen.getByRole('radio', { name: /Beacon only/ }));
    expect(screen.getByRole('radio', { name: /Beacon only/ })).toHaveAttribute('aria-checked', 'true');
}

afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Listener one-action playlist transport', () => {
    it('defaults to the English introduction and exposes one contextual action', async () => {
        prepareMedia();
        renderPlayer();

        expect(screen.getByRole('radio', { name: /With introduction/ })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getAllByText('Amara Sol · English')).toHaveLength(2);
        await waitForListen();
        expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    });

    it('remembers the device mode without changing the stream contract', async () => {
        prepareMedia();
        const first = renderPlayer();
        await chooseBeaconOnly();
        first.unmount();

        renderPlayer();
        await waitFor(() => expect(screen.getByRole('radio', { name: /Beacon only/ }))
            .toHaveAttribute('aria-checked', 'true'));
    });

    it('pauses and resumes the intro at the same position', async () => {
        const { play, pause } = prepareMedia();
        renderPlayer();
        const intro = screen.getByLabelText('Warm-up · English') as HTMLAudioElement;
        await waitForListen();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled());
        intro.currentTime = 42;
        pause.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        expect(pause.mock.instances).toContain(intro);
        expect(intro.currentTime).toBe(42);
        expect(screen.getByText('Paused')).toBeInTheDocument();

        play.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled());
        expect(play.mock.instances).toContain(intro);
        expect(intro.currentTime).toBe(42);
    });

    it('pauses and resumes the Beacon without restarting the transport', async () => {
        const { play, pause } = prepareMedia();
        renderPlayer();
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        await chooseBeaconOnly();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        Object.defineProperty(live, 'paused', { value: false, configurable: true });
        fireEvent.playing(live);
        live.currentTime = 73;
        pause.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        expect(pause.mock.instances).toContain(live);
        expect(live.currentTime).toBe(73);

        play.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled());
        expect(play.mock.instances).toContain(live);
        expect(live.currentTime).toBe(73);
    });

    it('shows real intro progress only while the intro is active', async () => {
        prepareMedia();
        renderPlayer();
        await waitForListen();
        expect(screen.queryByRole('slider', { name: 'Intro before the Beacon: Warm-up · English' }))
            .not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        expect(await screen.findByRole('slider', { name: 'Intro before the Beacon: Warm-up · English' }))
            .toBeInTheDocument();
        expect(screen.getByText('The Beacon follows')).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
    });

    it('hands off naturally from the intro to the Beacon using the approved fade', async () => {
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const { play } = prepareMedia();
        renderPlayer();
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        const intro = screen.getByLabelText('Warm-up · English') as HTMLAudioElement;
        await waitForListen();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await screen.findByText('Playing intro · Beacon follows');

        Object.defineProperty(intro, 'ended', { value: true, configurable: true });
        fireEvent.ended(intro);
        await waitFor(() => expect(play.mock.instances).toContain(live));
        Object.defineProperty(live, 'paused', { value: false, configurable: true });
        fireEvent.playing(live);
        frames.shift()?.(3_000);
        expect(live.volume).toBeCloseTo(1);
        expect(screen.getByText('Playing Beacon 24/7')).toBeInTheDocument();
    });

    it('can skip the private intro into the same Beacon handoff', async () => {
        const { play, pause } = prepareMedia();
        renderPlayer();
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        const intro = screen.getByLabelText('Warm-up · English') as HTMLAudioElement;
        await waitForListen();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await screen.findByText('Playing intro · Beacon follows');

        pause.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Skip to the Beacon' }));
        await waitFor(() => expect(play.mock.instances).toContain(live));
        expect(pause.mock.instances).toContain(intro);
    });

    it('stops Beacon playback over the existing fade and clears the active stage immediately', async () => {
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const { pause } = prepareMedia();
        renderPlayer();
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        await chooseBeaconOnly();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        Object.defineProperty(live, 'paused', { value: false, configurable: true });
        fireEvent.playing(live);
        frames.shift()?.(3_000);
        pause.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        expect(screen.getByText('Stopped')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
        expect(pause.mock.instances).not.toContain(live);
        act(() => frames.shift()?.(650));
        expect(pause.mock.instances).toContain(live);
    });
});
