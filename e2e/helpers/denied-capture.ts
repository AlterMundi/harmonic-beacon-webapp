import { isDeepStrictEqual } from 'node:util';
import { expect, type Page } from '@playwright/test';

export interface DeniedCaptureSnapshot {
    requests: Array<{ constraints: MediaStreamConstraints | undefined; outcome: 'denied' }>;
    attachedVideoTracks: number;
}

declare global {
    interface Window {
        fixtureDeniedCapture: () => DeniedCaptureSnapshot;
        fixtureDeniedCaptureDevices: MediaDevices;
    }
}

/** Browser init-script: deny ALL device acquisition, record exact constraints,
 * never call the original getUserMedia. Native audio/SDK playback stay real. */
export function denyDeviceCapture(): void {
    const requests: DeniedCaptureSnapshot['requests'] = [];
    // WebKit may collect/recreate the native wrapper and lose own-property
    // instrumentation unless this exact object stays reachable for the document.
    const devices = navigator.mediaDevices;
    window.fixtureDeniedCaptureDevices = devices;
    devices.getUserMedia = async (constraints) => {
        requests.push({ constraints: structuredClone(constraints), outcome: 'denied' });
        throw new DOMException('E2E device capture denied', 'NotAllowedError');
    };
    window.fixtureDeniedCapture = () => ({
        requests: structuredClone(requests),
        attachedVideoTracks: [...document.querySelectorAll('video')].reduce((count, video) =>
            count + ((video.srcObject as MediaStream | null)?.getTracks().length ?? 0), 0),
    });
}

/** The default-on ThumbnailSender has an exact video-only contract. Entry and
 * refresh each make one denied attempt; a disconnect/reconnect makes one more.
 * No arbitrary video request, microphone request, acquired track or extra
 * activation-triggered attempt is allowed. */
export function assertDeniedThumbnailCapture(snapshot: DeniedCaptureSnapshot, expectedAttempts: number): void {
    const expected = Array.from({ length: expectedAttempts }, () => ({
        constraints: { video: { width: 320, height: 320, facingMode: { ideal: 'user' } }, audio: false },
        outcome: 'denied',
    }));
    if (!isDeepStrictEqual(snapshot.requests, expected) || snapshot.attachedVideoTracks !== 0) {
        throw new Error(`unexpected capture: expected ${expectedAttempts} denied thumbnail-only attempts and no acquired video tracks; got ${JSON.stringify(snapshot)}`);
    }
}

export async function deniedCaptureSnapshot(page: Page): Promise<DeniedCaptureSnapshot> {
    return page.evaluate(() => window.fixtureDeniedCapture());
}

export async function expectDeniedThumbnailCapture(page: Page, expectedAttempts: number): Promise<DeniedCaptureSnapshot> {
    await expect.poll(async () => (await deniedCaptureSnapshot(page)).requests.length,
        { message: 'expected default-on thumbnail lifecycle capture attempt' }).toBe(expectedAttempts);
    const snapshot = await deniedCaptureSnapshot(page);
    assertDeniedThumbnailCapture(snapshot, expectedAttempts);
    return snapshot;
}
