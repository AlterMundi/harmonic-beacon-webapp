// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ThumbnailSender from '@/components/session/ThumbnailSender';
import { LocaleProvider } from '@/context/LocaleContext';
import { assertDeniedThumbnailCapture, denyDeviceCapture, type DeniedCaptureSnapshot } from '../../../e2e/helpers/denied-capture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const thumbnail: DeniedCaptureSnapshot['requests'][number] = {
    constraints: { video: { width: 320, height: 320, facingMode: { ideal: 'user' } }, audio: false },
    outcome: 'denied',
};

describe('no-capture audio fixture contract', () => {
    it('strongly retains the exact instrumented MediaDevices wrapper for the document lifetime', async () => {
        const nativeCapture = vi.fn();
        const devices = { getUserMedia: nativeCapture };
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
        denyDeviceCapture();
        expect((window as unknown as { fixtureDeniedCaptureDevices: MediaDevices }).fixtureDeniedCaptureDevices).toBe(devices);
        await expect(devices.getUserMedia(thumbnail.constraints)).rejects.toMatchObject({ name: 'NotAllowedError' });
        assertDeniedThumbnailCapture(window.fixtureDeniedCapture(), 1);
        expect(nativeCapture).not.toHaveBeenCalled();
    });
    it('records the real ThumbnailSender lifecycle without acquiring devices or retrying on unrelated renders', async () => {
        const nativeCapture = vi.fn();
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: nativeCapture } });
        denyDeviceCapture();
        const thumbnailView = (connected: boolean) => <LocaleProvider initialLocale="en">
            <ThumbnailSender sessionId="test-session" connected={connected} isPublishing={false} />
        </LocaleProvider>;
        const view = render(thumbnailView(true));
        await waitFor(() => assertDeniedThumbnailCapture(window.fixtureDeniedCapture(), 1));
        const before = window.fixtureDeniedCapture();
        view.rerender(thumbnailView(true));
        expect(window.fixtureDeniedCapture()).toEqual(before);
        view.rerender(thumbnailView(false));
        view.rerender(thumbnailView(true));
        await waitFor(() => assertDeniedThumbnailCapture(window.fixtureDeniedCapture(), 2));
        expect(nativeCapture).not.toHaveBeenCalled();
        expect(document.querySelector('video')?.srcObject).toBeFalsy();
    });

    it('denies and records microphone requests too, rather than acquiring a device or hiding the violation', async () => {
        const nativeCapture = vi.fn();
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: nativeCapture } });
        denyDeviceCapture();
        await expect(navigator.mediaDevices.getUserMedia({ audio: true })).rejects.toMatchObject({ name: 'NotAllowedError' });
        expect(window.fixtureDeniedCapture().requests).toEqual([{ constraints: { audio: true }, outcome: 'denied' }]);
        expect(() => assertDeniedThumbnailCapture(window.fixtureDeniedCapture(), 1)).toThrow();
        expect(nativeCapture).not.toHaveBeenCalled();
    });
    it('accepts exactly the existing denied video-only thumbnail attempt, with no acquired video tracks', () => {
        expect(() => assertDeniedThumbnailCapture({ requests: [thumbnail], attachedVideoTracks: 0 }, 1)).not.toThrow();
    });
    it('accounts explicitly for a real thumbnail connected=false/true lifecycle, not SDK resume', () => {
        expect(() => assertDeniedThumbnailCapture({ requests: [thumbnail, thumbnail], attachedVideoTracks: 0 }, 2)).not.toThrow();
    });
    it.each([
        { label: 'microphone request', requests: [{ ...thumbnail, constraints: { audio: true, video: false } }], attachedVideoTracks: 0 },
        { label: 'unknown video capture', requests: [{ ...thumbnail, constraints: { video: true, audio: false } }], attachedVideoTracks: 0 },
        { label: 'unexpected extra thumbnail request during audio activation', requests: [thumbnail, thumbnail], attachedVideoTracks: 0 },
        { label: 'missing thumbnail evidence', requests: [], attachedVideoTracks: 0 },
        { label: 'acquired camera track', requests: [thumbnail], attachedVideoTracks: 1 },
    ])('rejects $label', ({ requests, attachedVideoTracks }) => {
        expect(() => assertDeniedThumbnailCapture({ requests, attachedVideoTracks }, 1)).toThrow();
    });
});
