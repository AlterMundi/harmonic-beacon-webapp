// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ThumbnailSender from '../ThumbnailSender';
import { LocaleProvider, useLocale } from '@/context/LocaleContext';
import { messages } from '@/lib/i18n';

function LocaleControls() {
    const { setLocale } = useLocale();
    return <><button onClick={() => setLocale('es')}>ES</button><button onClick={() => setLocale('en')}>EN</button></>;
}

function render(ui: ReactNode) {
    return rtlRender(ui, { wrapper: ({ children }) => <LocaleProvider initialLocale="en">{children}</LocaleProvider> });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function mockCamera() {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const getUserMedia = vi.fn().mockImplementation(async () => {
        const stop = vi.fn();
        stops.push(stop);
        return { getTracks: () => [{ stop }] } as unknown as MediaStream;
    });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpeg'], { type: 'image/jpeg' })));
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    return { stops, getUserMedia };
}

describe('ThumbnailSender', () => {
    it('counts denied capture attempts in the continuity probe, including VIDEO-only and audio separately', async () => {
        const { installMediaProbe, expectMediaContinuity } = await import('../../../../e2e/helpers/media-probe');
        const { getUserMedia } = mockCamera();
        getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
        // Execute the real init script in jsdom; only the browser/device boundary
        // is simulated. Snapshot comparison is the same one used by full-stack.
        await installMediaProbe({ addInitScript: async (fn: (options: object) => void) => fn({}) } as unknown as import('@playwright/test').Page);
        const before = window.__hbMediaProbe!.snapshot();
        await expect(navigator.mediaDevices.getUserMedia({ video: true, audio: false })).rejects.toThrow();
        const video = window.__hbMediaProbe!.snapshot();
        expect(video.captureAttempts).toBe(1);
        expect(video.videoCaptureAttempts).toBe(1);
        expect(video.audioCaptureAttempts).toBe(0);
        expect(() => expectMediaContinuity(before, video)).toThrow(/capture/);
        await expect(navigator.mediaDevices.getUserMedia({ audio: true })).rejects.toThrow();
        expect(window.__hbMediaProbe!.snapshot().audioCaptureAttempts).toBe(1);
    });

    it('does not retry denied VIDEO-only default capture on locale changes; translates the current error and permits explicit retry', async () => {
        const { getUserMedia } = mockCamera();
        getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
        render(<><LocaleControls /><ThumbnailSender sessionId="session-1" connected isPublishing={false} /></>);
        await screen.findByText(messages.en.tapestry.permissionDenied);
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        for (const locale of ['es', 'en', 'es'] as const) {
            fireEvent.click(screen.getByRole('button', { name: locale.toUpperCase() }));
            await screen.findByText(messages[locale].tapestry.permissionDenied);
            expect(getUserMedia).toHaveBeenCalledTimes(1);
        }
        fireEvent.click(screen.getByRole('button', { name: messages.es.tapestry.shareSnapshot }));
        await screen.findByText(messages.es.tapestry.permissionDenied);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(getUserMedia.mock.calls.every(([constraints]) => constraints.audio === false && !!constraints.video)).toBe(true);
    });

    it('uses current locale when an already-pending camera denial settles, without another request', async () => {
        const { getUserMedia } = mockCamera();
        let deny!: (error: Error) => void;
        getUserMedia.mockImplementation(() => new Promise((_resolve, reject) => { deny = reject; }));
        render(<><LocaleControls /><ThumbnailSender sessionId="session-1" connected isPublishing={false} /></>);
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'ES' }));
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        await act(async () => deny(new DOMException('Denied', 'NotAllowedError')));
        expect(screen.getByText(messages.es.tapestry.permissionDenied)).toBeVisible();
        expect(screen.queryByText(messages.en.tapestry.permissionDenied)).not.toBeInTheDocument();
    });

    it('locale changes preserve acquired camera and explicit opt-out without requesting audio', async () => {
        const { getUserMedia, stops } = mockCamera();
        render(<><LocaleControls /><ThumbnailSender sessionId="session-1" connected isPublishing={false} /></>);
        await screen.findByRole('button', { name: messages.en.tapestry.stopCamera });
        fireEvent.click(screen.getByRole('button', { name: 'ES' }));
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(stops[0]).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: messages.es.tapestry.stopCamera }));
        fireEvent.click(screen.getByRole('button', { name: 'EN' }));
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(stops[0]).toHaveBeenCalledOnce();
        expect(getUserMedia.mock.calls[0][0].audio).toBe(false);
    });

    it('starts the camera by default once connected, and releases it on stage promotion', async () => {
        const { stops, getUserMedia } = mockCamera();

        const view = render(<ThumbnailSender sessionId="session-1" connected isPublishing={false} />);
        // Default-on (product decision 2026-07-31): no click needed.
        await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('/api/tapestry/frame?sessionId=session-1');

        view.rerender(<ThumbnailSender sessionId="session-1" connected isPublishing />);
        await waitFor(() => expect(stops[0]).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: /tapestry/i })).not.toBeInTheDocument();
    });

    it('stays off after an explicit opt-out until the attendee opts back in', async () => {
        const { stops, getUserMedia } = mockCamera();

        const view = render(<ThumbnailSender sessionId="session-1" connected isPublishing={false} />);
        await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: 'Stop sharing your camera with the tapestry' }));
        await waitFor(() => expect(stops[0]).toHaveBeenCalled());

        // A re-render (e.g. state change elsewhere in the room) must not
        // restart the camera after an explicit opt-out.
        view.rerender(<ThumbnailSender sessionId="session-1" connected isPublishing={false} />);
        expect(getUserMedia).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Share a camera snapshot' }));
        await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    });

    it('switches the tapestry camera explicitly without requesting or changing audio', async () => {
        const { stops, getUserMedia } = mockCamera();

        render(<ThumbnailSender sessionId="session-1" connected isPublishing={false} />);
        await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
        expect(getUserMedia).toHaveBeenNthCalledWith(1, {
            video: { width: 320, height: 320, facingMode: { ideal: 'user' } },
            audio: false,
        });

        // getUserMedia resolving and React committing `enabled` are separate
        // async boundaries. Wait for the control that proves the latter;
        // checking only the mock call makes this test scheduler-dependent.
        fireEvent.click(await screen.findByRole('button', { name: 'Switch to rear camera' }));

        await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
        expect(stops[0]).toHaveBeenCalledOnce();
        expect(getUserMedia).toHaveBeenNthCalledWith(2, {
            video: { width: 320, height: 320, facingMode: { ideal: 'environment' } },
            audio: false,
        });
        expect(screen.getByRole('button', { name: 'Switch to front camera' })).toBeInTheDocument();
        expect(getUserMedia.mock.calls.every(([constraints]) => constraints?.audio === false)).toBe(true);
    });
});
