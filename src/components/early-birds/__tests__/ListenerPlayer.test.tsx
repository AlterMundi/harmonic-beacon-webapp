// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { LocaleProvider } from '@/context/LocaleContext';
import ListenerPlayer, {
    getOrCreateEarlyBirdDeviceId,
    seekNativeAudioToLiveEdge,
} from '../ListenerPlayer';

afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
        expect(screen.getByRole('slider', { name: 'Master volume' })).toHaveValue('1');
    });

    it('keeps the Beacon timeline, source and lease untouched across drop-in pause and end', async () => {
        const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: '2026-08-06T12:03:00.000Z',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
                expiresAt: '2099-08-06T12:03:00.000Z',
            },
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);

        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{
                    es: 'https://media.example.test/drop-es.mp3',
                    en: 'https://media.example.test/drop-en.mp3',
                }} />
            </LocaleProvider>,
        );
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        const spanish = screen.getByLabelText('Warm-up · Spanish') as HTMLAudioElement;
        const spanishCard = spanish.closest('article')!;

        fireEvent.click(screen.getByRole('button', { name: 'Listen live' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument());
        const liveSource = live.src;
        const leaseRequests = fetchMock.mock.calls.length;
        const livePlayCalls = play.mock.instances.filter((instance) => instance === live).length;
        pause.mockClear();

        fireEvent.click(within(spanishCard).getByRole('button', { name: 'Play' }));
        await waitFor(() => expect(within(spanishCard).getByRole('button', { name: 'Pause' })).toBeInTheDocument());
        expect(live.muted).toBe(true);
        expect(pause.mock.instances).not.toContain(live);
        expect(fetchMock).toHaveBeenCalledTimes(leaseRequests);
        expect(live.src).toBe(liveSource);

        fireEvent.click(within(spanishCard).getByRole('button', { name: 'Pause' }));
        expect(live.muted).toBe(false);
        expect(pause.mock.instances).not.toContain(live);
        expect(fetchMock).toHaveBeenCalledTimes(leaseRequests);

        fireEvent.click(within(spanishCard).getByRole('button', { name: 'Play' }));
        await waitFor(() => expect(live.muted).toBe(true));
        fireEvent.ended(spanish);
        expect(live.muted).toBe(false);
        expect(live.src).toBe(liveSource);
        expect(fetchMock).toHaveBeenCalledTimes(leaseRequests);
        expect(play.mock.instances.filter((instance) => instance === live)).toHaveLength(livePlayCalls);
        expect(pause.mock.instances).not.toContain(live);
    });

    it('keeps a drop-in independent when the Beacon has never started', async () => {
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: 'https://media.example.test/drop-es.mp3', en: null }} />
            </LocaleProvider>,
        );
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        const spanish = screen.getByLabelText('Warm-up · Spanish') as HTMLAudioElement;
        const card = spanish.closest('article')!;
        fireEvent.click(within(card).getByRole('button', { name: 'Play' }));
        await waitFor(() => expect(play).toHaveBeenCalled());
        fireEvent.ended(spanish);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(live.src).toBe('');
        expect(live.muted).toBe(false);
        expect(play.mock.instances).not.toContain(live);
    });
});
