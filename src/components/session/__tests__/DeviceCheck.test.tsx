// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/context/LocaleContext';
import DeviceCheck from '../DeviceCheck';

const capture = vi.fn();
const close = vi.fn().mockResolvedValue(undefined);
const source = vi.fn(() => ({ connect: vi.fn() }));
function stream(kind: 'audio' | 'video') {
    const track = { stop: vi.fn(), addEventListener: vi.fn() };
    return { getTracks: () => [track], getAudioTracks: () => kind === 'audio' ? [track] : [], getVideoTracks: () => kind === 'video' ? [track] : [], track };
}
const view = () => render(<LocaleProvider initialLocale="en"><DeviceCheck /></LocaleProvider>);
beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:local-test-tone');
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: capture, enumerateDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() } });
    vi.stubGlobal('AudioContext', class {
        close = close;
        resume = vi.fn().mockResolvedValue(undefined);
        createMediaStreamSource = source;
        createAnalyser = () => ({ fftSize: 512, getByteTimeDomainData: vi.fn() });
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('local device check privacy and lifecycle', () => {
    it('requests no capture on entry, starts inputs independently, and releases its own tracks on departure', async () => {
        const mic = stream('audio'); const cam = stream('video');
        capture.mockResolvedValueOnce(mic).mockResolvedValueOnce(cam);
        const rendered = view();
        expect(capture).not.toHaveBeenCalled();
        expect(navigator.mediaDevices.enumerateDevices).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Test microphone' }));
        await screen.findByRole('button', { name: 'Stop microphone' });
        expect(capture).toHaveBeenNthCalledWith(1, { audio: true, video: false });
        expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Test camera' }));
        await screen.findByRole('button', { name: 'Stop camera' });
        expect(capture).toHaveBeenNthCalledWith(2, { video: true, audio: false });
        expect(document.querySelector('video')?.srcObject).toBe(cam);
        rendered.unmount();
        expect(mic.track.stop).toHaveBeenCalledOnce(); expect(cam.track.stop).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-test-tone');
    });
    it('retires a camera permission result that arrives after Stop all', async () => {
        let resolve!: (value: unknown) => void;
        capture.mockReturnValueOnce(new Promise(value => { resolve = value; }));
        view();
        fireEvent.click(screen.getByRole('button', { name: 'Test camera' }));
        fireEvent.click(screen.getByRole('button', { name: 'Stop all checks' }));
        const late = stream('video');
        await act(async () => resolve(late));
        expect(late.track.stop).toHaveBeenCalledOnce();
        expect(document.querySelector('video')?.srcObject).toBeFalsy();
        expect(screen.getByRole('button', { name: 'Test camera' })).toBeEnabled();
    });
    it('keeps denial retry explicit and retains the camera when the microphone stops', async () => {
        capture.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
        view();
        fireEvent.click(screen.getByRole('button', { name: 'Test microphone' }));
        await screen.findByRole('alert');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Test microphone' })).toBeEnabled());
        expect(capture).toHaveBeenCalledOnce();
        const cam = stream('video'); const mic = stream('audio');
        capture.mockResolvedValueOnce(cam).mockResolvedValueOnce(mic);
        fireEvent.click(screen.getByRole('button', { name: 'Test camera' }));
        await screen.findByRole('button', { name: 'Stop camera' });
        fireEvent.click(screen.getByRole('button', { name: 'Test microphone' }));
        await screen.findByRole('button', { name: 'Stop microphone' });
        fireEvent.click(screen.getByRole('button', { name: 'Stop microphone' }));
        expect(mic.track.stop).toHaveBeenCalledOnce(); expect(cam.track.stop).not.toHaveBeenCalled();
    });
});
