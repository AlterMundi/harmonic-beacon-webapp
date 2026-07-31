// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ThumbnailSender from '../ThumbnailSender';

afterEach(() => vi.restoreAllMocks());

function mockCamera() {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpeg'], { type: 'image/jpeg' })));
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    return { stop, getUserMedia };
}

describe('ThumbnailSender', () => {
    it('starts the camera by default once connected, and releases it on stage promotion', async () => {
        const { stop, getUserMedia } = mockCamera();

        const view = render(<ThumbnailSender sessionId="session-1" connected isPublishing={false} />);
        // Default-on (product decision 2026-07-31): no click needed.
        await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('/api/tapestry/frame?sessionId=session-1');

        view.rerender(<ThumbnailSender sessionId="session-1" connected isPublishing />);
        await waitFor(() => expect(stop).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: /tapestry/i })).not.toBeInTheDocument();
    });

    it('stays off after an explicit opt-out until the attendee opts back in', async () => {
        const { stop, getUserMedia } = mockCamera();

        const view = render(<ThumbnailSender sessionId="session-1" connected isPublishing={false} />);
        await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: 'Stop tapestry camera' }));
        await waitFor(() => expect(stop).toHaveBeenCalled());

        // A re-render (e.g. state change elsewhere in the room) must not
        // restart the camera after an explicit opt-out.
        view.rerender(<ThumbnailSender sessionId="session-1" connected isPublishing={false} />);
        expect(getUserMedia).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Share a camera snapshot' }));
        await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    });
});
