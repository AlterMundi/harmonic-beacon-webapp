import { AxeBuilder } from '@axe-core/playwright';
import { test, expect } from '../fixtures/stack';

test('local pre-meeting checks need gestures, never upload inputs, and stop before continuing', async ({ page }, testInfo) => {
    const requests: string[] = [];
    page.on('request', request => { if (request.method() !== 'GET') requests.push(new URL(request.url()).pathname); });
    await page.addInitScript(() => {
        const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        const inputs: MediaStream[] = [];
        (window as unknown as { checkedInputs: MediaStream[] }).checkedInputs = inputs;
        navigator.mediaDevices.getUserMedia = async constraints => { const stream = await capture(constraints); inputs.push(stream); return stream; };
    });
    await page.goto('/devices');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Probá tus dispositivos|Check your devices/);
    const trackStates = () => page.evaluate(() => (window as unknown as { checkedInputs: MediaStream[] }).checkedInputs.flatMap(stream => stream.getTracks().map(track => track.readyState)));
    expect(await trackStates()).toEqual([]);
    await page.getByRole('button', { name: /Probar micrófono|Test microphone/ }).click();
    await expect(page.getByRole('button', { name: /Detener micrófono|Stop microphone/ })).toBeEnabled();
    await expect.poll(async () => page.getByRole('progressbar').evaluate((node: HTMLProgressElement) => node.value)).toBeGreaterThan(0);
    await page.getByRole('button', { name: /Probar cámara|Test camera/ }).click();
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    await page.getByRole('button', { name: /Reproducir sonido de prueba|Play test sound/ }).click();
    await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
    await page.getByRole('button', { name: /Detener todas las pruebas|Stop all checks/ }).click();
    await expect.poll(trackStates).toEqual(['ended', 'ended']);
    expect(requests).toEqual([]);
    for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        await testInfo.attach(`device-check-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.filter(violation => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});
