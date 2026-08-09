// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LocaleProvider } from '@/context/LocaleContext';
import type { UiLocale } from '@/lib/i18n';

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
    leaseGeneration: 1,
    presenceSequence: 0,
    leaseExpiresAt: '2099-08-06T12:03:00.000Z',
    stream: {
        manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003&leaseGeneration=1',
        expiresAt: '2099-08-06T12:03:00.000Z',
    },
};

function prepareMedia() {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(GRANT), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    }))));
    return { play, pause };
}

function renderPlayer(
    dropIns: { es: string | null; en: string | null } = { es: null, en: '/api/drop-ins/en' },
    initialLocale: UiLocale = 'en',
) {
    return render(
        <LocaleProvider initialLocale={initialLocale}>
            <ListenerPlayer dropIns={dropIns} />
        </LocaleProvider>,
    );
}

async function waitForListen() {
    await waitFor(() => expect(screen.getByRole('button', { name: /^(Listen|Escuchar)$/ })).toBeEnabled());
}

async function chooseBeaconOnly() {
    await waitForListen();
    const intro = screen.getByRole('checkbox', { name: /Play introduction first/ });
    fireEvent.click(intro);
    expect(intro).not.toBeChecked();
}

function expectPhase(phase: string) {
    expect(screen.getByRole('heading', { name: 'Beacon' }).closest('.listener-experience'))
        .toHaveAttribute('data-phase', phase);
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

        expect(screen.getByRole('checkbox', { name: /Play introduction first/ })).toBeChecked();
        expect(screen.queryByText('Amara Sol · English')).not.toBeInTheDocument();
        await waitForListen();
        expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    });

    it('uses the browser-derived page language to play only the matching introduction', async () => {
        const { play } = prepareMedia();
        renderPlayer({ es: '/api/drop-ins/es', en: '/api/drop-ins/en' }, 'es');
        const spanish = screen.getByLabelText('Introducción · Español') as HTMLAudioElement;
        const english = screen.getByLabelText('Introducción · Inglés') as HTMLAudioElement;
        await waitForListen();

        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Idioma de la introducción' }))
            .toHaveValue('es'));
        play.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Escuchar' }));

        await waitFor(() => expect(play.mock.instances).toContain(spanish));
        expect(play.mock.instances).not.toContain(english);
    });

    it('lets the intro dropdown override the browser-language default', async () => {
        const { play } = prepareMedia();
        renderPlayer({ es: '/api/drop-ins/es', en: '/api/drop-ins/en' }, 'es');
        const spanish = screen.getByLabelText('Introducción · Español') as HTMLAudioElement;
        const english = screen.getByLabelText('Introducción · Inglés') as HTMLAudioElement;
        await waitForListen();

        fireEvent.change(screen.getByRole('combobox', { name: 'Idioma de la introducción' }), {
            target: { value: 'en' },
        });
        play.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Escuchar' }));

        await waitFor(() => expect(play.mock.instances).toContain(english));
        expect(play.mock.instances).not.toContain(spanish);
    });

    it('hides introduction setup while playback is active and restores it after Stop', async () => {
        prepareMedia();
        renderPlayer({ es: '/api/drop-ins/es', en: '/api/drop-ins/en' });
        await waitForListen();

        expect(screen.getByRole('checkbox', { name: /Play introduction first/ })).toBeChecked();
        expect(screen.getByRole('combobox', { name: 'Introduction language' })).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
        expect(screen.queryByRole('checkbox', { name: /Play introduction first/ })).toBeNull();
        expect(screen.queryByRole('combobox', { name: 'Introduction language' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        expect(screen.getByRole('checkbox', { name: /Play introduction first/ })).toBeChecked();
        expect(screen.getByRole('combobox', { name: 'Introduction language' })).toBeVisible();
    });

    it('remembers the device mode without changing the stream contract', async () => {
        prepareMedia();
        const first = renderPlayer();
        await chooseBeaconOnly();
        first.unmount();

        renderPlayer();
        await waitFor(() => expect(screen.getByRole('checkbox', { name: /Play introduction first/ }))
            .not.toBeChecked());
    });

    it('uses one native checkbox to choose whether the introduction plays first', async () => {
        prepareMedia();
        renderPlayer();
        await waitForListen();
        const intro = screen.getByRole('checkbox', { name: /Play introduction first/ });
        expect(intro).toBeChecked();
        fireEvent.click(intro);
        expect(intro).not.toBeChecked();
        fireEvent.click(intro);
        expect(intro).toBeChecked();
    });

    it('does not show an irrelevant introduction choice when no intro exists', async () => {
        prepareMedia();
        renderPlayer({ es: null, en: null });
        await waitForListen();
        expect(screen.queryByRole('checkbox', { name: /Play introduction first/ })).toBeNull();
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

        const pauseButton = screen.getByRole('button', { name: 'Pause' });
        const stopButton = screen.getByRole('button', { name: 'Stop' });
        expect(pauseButton).toHaveClass('listener-transport__primary');
        expect(stopButton).toHaveClass('listener-transport__secondary');
        expect(pauseButton.compareDocumentPosition(stopButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        fireEvent.click(pauseButton);
        expect(pause.mock.instances).toContain(intro);
        expect(intro.currentTime).toBe(42);
        expectPhase('paused');

        play.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled());
        expect(play.mock.instances).toContain(intro);
        expect(intro.currentTime).toBe(42);
    });

    it('treats the Beacon as live: Stop is available but Pause and Seek are not', async () => {
        prepareMedia();
        renderPlayer();
        const live = screen.getByLabelText('Beacon');
        await chooseBeaconOnly();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        Object.defineProperty(live, 'paused', { value: false, configurable: true });
        fireEvent.playing(live);
        const stop = screen.getByRole('button', { name: 'Stop' });
        expect(stop).toBeEnabled();
        expect(stop).toHaveClass('listener-transport__secondary');
        expect(stop.parentElement).toHaveClass('listener-transport--stop-only');
        expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
        expect(screen.queryByRole('slider', { name: 'Seek' })).not.toBeInTheDocument();
    });

    it('labels a required device claim truthfully and waits for a second gesture before playback', async () => {
        const { play } = prepareMedia();
        const requests: string[] = [];
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockImplementation(async (_input, init) => {
            const intent = JSON.parse(String(init?.body ?? '{}')).intent as string | undefined;
            if (intent) requests.push(intent);
            if (intent === 'prepare') return new Response(null, { status: 409 });
            return new Response(JSON.stringify(GRANT), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });
        renderPlayer({ es: '/api/drop-ins/es', en: '/api/drop-ins/en' });

        const enable = await screen.findByRole('button', { name: 'Enable this device' });
        expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull();
        play.mockClear();
        fireEvent.click(enable);

        await waitForListen();
        expect(requests).toEqual(['prepare', 'claim']);
        expect(play).not.toHaveBeenCalled();
    });

    it('shows real intro progress only while the intro is active', async () => {
        prepareMedia();
        renderPlayer();
        await waitForListen();
        expect(screen.queryByRole('slider', { name: 'Seek' }))
            .not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        expect(await screen.findByRole('slider', { name: 'Seek' }))
            .toBeInTheDocument();
        expect(screen.queryByText('Amara Sol · English')).not.toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.7');
    });

    it('updates media-element volume directly without changing the live transport state', async () => {
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const { pause } = prepareMedia();
        renderPlayer();
        const live = screen.getByLabelText('Beacon') as HTMLAudioElement;
        await chooseBeaconOnly();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        Object.defineProperty(live, 'paused', { value: false, configurable: true });
        fireEvent.playing(live);
        frames.shift()?.(3_000);
        pause.mockClear();

        for (const value of ['0.85', '0.62', '0.4']) {
            fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value } });
        }

        expect(live.volume).toBeCloseTo(0.4);
        expectPhase('beacon');
        expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
        expect(pause.mock.instances).not.toContain(live);
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
        const live = screen.getByLabelText('Beacon') as HTMLAudioElement;
        const intro = screen.getByLabelText('Warm-up · English') as HTMLAudioElement;
        await waitForListen();
        play.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expectPhase('intro'));
        // Safari authorizes each media element independently. The live element
        // must begin muted in the original gesture; starting it only from the
        // later ended event is rejected on physical iPhones.
        expect(play.mock.instances).toContain(live);
        expect(play.mock.instances).toContain(intro);
        expect(live.muted).toBe(true);
        Object.defineProperty(live, 'paused', { value: false, configurable: true });
        fireEvent.playing(live);
        expect(live.muted).toBe(true);
        play.mockClear();

        Object.defineProperty(intro, 'ended', { value: true, configurable: true });
        fireEvent.ended(intro);
        expect(play.mock.instances).not.toContain(live);
        frames.shift()?.(3_000);
        expect(live.volume).toBeCloseTo(0.7);
        expect(live.muted).toBe(false);
        expectPhase('beacon');
    });

    it('can skip the private intro into the same Beacon handoff', async () => {
        const { play, pause } = prepareMedia();
        renderPlayer();
        const live = screen.getByLabelText('Beacon') as HTMLAudioElement;
        const intro = screen.getByLabelText('Warm-up · English') as HTMLAudioElement;
        await waitForListen();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expectPhase('intro'));

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
        const live = screen.getByLabelText('Beacon') as HTMLAudioElement;
        await chooseBeaconOnly();
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        Object.defineProperty(live, 'paused', { value: false, configurable: true });
        fireEvent.playing(live);
        frames.shift()?.(3_000);
        pause.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        expectPhase('stopped');
        expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
        expect(pause.mock.instances).not.toContain(live);
        act(() => frames.shift()?.(650));
        expect(pause.mock.instances).toContain(live);
    });
});
