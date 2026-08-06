import { expect, test } from '@playwright/test';

async function expectNoHorizontalScroll(page: import('@playwright/test').Page): Promise<void> {
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'EarlyBirds page has horizontal overflow').toBeLessThanOrEqual(1);
}

test.describe('EarlyBirds responsive bilingual boundary', () => {
    test.beforeEach(async ({ page }) => {
        await page.setExtraHTTPHeaders({ 'x-forwarded-proto': 'https' });
    });

    test('landing remains reachable and complete in ES and EN', async ({ page }) => {
        await page.goto('/early-birds');
        await expectNoHorizontalScroll(page);

        const viewport = page.viewportSize();
        expect(viewport).not.toBeNull();
        for (const name of ['Nombre de prueba', 'Cuenta sintética', 'Código de acceso temporal']) {
            const control = page.getByLabel(name);
            await expect(control).toBeVisible();
            const box = await control.boundingBox();
            expect(box, `${name} has no layout box`).not.toBeNull();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
        }

        await page.getByRole('button', { name: 'EN' }).click();
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.getByRole('heading', { name: 'The Beacon, always present.' })).toBeVisible();
        await expect(page.getByLabel('Test name')).toBeVisible();
        await expect(page.getByLabel('Synthetic account')).toBeVisible();
        await expect(page.getByLabel('Temporary access code')).toBeVisible();
        await expectNoHorizontalScroll(page);
    });

    test('private Listener remains in bounds without requesting event media', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(window, '__earlyBirdMediaRequests', {
                value: 0,
                writable: true,
            });
            const mediaDevices = navigator.mediaDevices;
            if (!mediaDevices?.getUserMedia) return;
            const original = mediaDevices.getUserMedia.bind(mediaDevices);
            mediaDevices.getUserMedia = (...constraints: Parameters<typeof original>) => {
                (window as typeof window & { __earlyBirdMediaRequests: number }).__earlyBirdMediaRequests += 1;
                return original(...constraints);
            };
        });
        const response = await page.request.post('/api/early-birds/test-login', {
            headers: {
                authorization: 'Bearer early-birds-e2e-login-secret-not-for-production',
                'x-forwarded-proto': 'https',
            },
            data: {
                email: `responsive-${test.info().project.name}@e2e.invalid`,
                name: 'Responsive Listener',
            },
        });
        expect(response.status()).toBe(200);

        await page.goto('/early-birds/home');
        await expect(page.getByRole('heading', { name: 'Beacon 24/7' })).toBeVisible();
        await expect(page.getByText('Responsive Listener')).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expect.poll(() => page.evaluate(
            () => (window as typeof window & { __earlyBirdMediaRequests: number }).__earlyBirdMediaRequests,
        )).toBe(0);
    });
});
