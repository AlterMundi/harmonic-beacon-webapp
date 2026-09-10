import { test, expect } from '@playwright/test';
import { navigationBrowser } from '../fixtures/navigation-browser';
import { installMediaProbe, mediaProbeSnapshot } from '../helpers/media-probe';

test('navigation capture probe retains interception after browser garbage collection', async ({ page }) => {
    // Model WebKit's collectable platform wrapper without granting devices or
    // depending on engine GC heuristics. The real probe runs unchanged; only
    // this browser-boundary getter is simulated. A recreated wrapper loses all
    // own-property instrumentation, just as in the recorded WebKit failure.
    await page.addInitScript(() => {
        let wrapper: WeakRef<{ getUserMedia: () => Promise<never> }>;
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            get() {
                let devices = wrapper?.deref();
                if (!devices) {
                    devices = { getUserMedia: async () => { throw new DOMException('Uninstrumented device request', 'NotAllowedError'); } };
                    wrapper = new WeakRef(devices);
                }
                return devices;
            },
        });
    });
    const fixture = await navigationBrowser();
    try {
        await installMediaProbe(page, { denyCapture: true });
        await page.goto(`${fixture.origin}/away`);
        // Do not retain the devices wrapper in test code: that would hide the bug.
        // WebKit can collect this wrapper and lose its own getUserMedia override.
        for (let turn = 0; turn < 5; turn++) {
            await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
            await page.requestGC();
        }
        const denial = await page.evaluate(async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                stream.getTracks().forEach(track => track.stop());
                return 'capture unexpectedly succeeded';
            } catch (error) {
                return (error as Error).message;
            }
        });
        expect(await mediaProbeSnapshot(page)).toMatchObject({
            captureAttempts: 1, videoCaptureAttempts: 1, audioCaptureAttempts: 0,
        });
        expect(denial).toBe('Fixture device permission denied');
    } finally { await page.close(); await fixture.close(); }
});
