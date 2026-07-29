// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ThumbnailSender from '../ThumbnailSender';

afterEach(() => vi.restoreAllMocks());

describe('ThumbnailSender', () => {
    it('does not request a camera until opt-in, and releases it on stage promotion', async () => {
        const stop = vi.fn();
        const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
        const getUserMedia = vi.fn().mockResolvedValue(stream);
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpeg'], { type: 'image/jpeg' })));
        global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

        const view = render(<ThumbnailSender sessionId="session-1" connected isPublishing={false} />);
        expect(getUserMedia).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Share an optional camera snapshot' }));
        await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('/api/tapestry/frame?sessionId=session-1');

        view.rerender(<ThumbnailSender sessionId="session-1" connected isPublishing />);
        await waitFor(() => expect(stop).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: /tapestry/i })).not.toBeInTheDocument();
    });
});
