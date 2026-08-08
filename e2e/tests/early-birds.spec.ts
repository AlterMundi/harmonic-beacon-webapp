import { expect, test } from '@playwright/test';

test.describe('Listener staging boundary', () => {
    test.beforeEach(async ({ page }) => {
        await page.setExtraHTTPHeaders({ 'x-forwarded-proto': 'https' });
    });

    test('serves the current bilingual public journey with only configured entry methods', async ({ page }) => {
        await page.goto('/listener');

        await expect(page.getByRole('heading', { name: 'Recuerda tu centro armónico.' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Entrar al Beacon' })).toBeVisible();
        await expect(page.getByText('Acceso de equipo · staging')).toBeVisible();
        await expect(page.getByRole('button', { name: /Continuar con Google|Continuar con Apple/ })).toHaveCount(0);
        await expect(page.getByLabel('Correo electrónico')).toHaveCount(0);
    });

    test('keeps the legacy private-home URL as a canonical compatibility redirect', async ({ page }) => {
        await page.goto('/early-birds/home');

        await expect(page).toHaveURL(/\/listener$/);
        await expect(page.getByRole('heading', { name: 'Recuerda tu centro armónico.' })).toBeVisible();
    });

    test('submits the staging team credential once and never persists it', async ({ page }) => {
        const accessCode = 'browser-entered-staging-code-000000000001';
        let authorization = '';
        await page.route('**/api/early-birds/test-login', async (route) => {
            authorization = route.request().headers().authorization ?? '';
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Synthetic login failed.' }),
            });
        });

        await page.goto('/listener');
        await page.getByLabel('Nombre de prueba').fill('Browser Team Listener');
        await page.getByLabel('Cuenta sintética').fill('browser.team@e2e.invalid');
        await page.getByLabel('Código de acceso temporal').fill(accessCode);
        await page.getByRole('button', { name: 'Entrar a staging' }).click();

        await expect(page.getByText('El acceso de prueba no está disponible o los datos no son válidos.')).toBeVisible();
        expect(authorization).toBe(`Bearer ${accessCode}`);
        await expect(page.getByLabel('Código de acceso temporal')).toHaveValue('');
        expect(await page.evaluate(() => JSON.stringify({
            local: { ...localStorage },
            session: { ...sessionStorage },
        }))).not.toContain(accessCode);
    });

    test('creates an isolated synthetic session and reaches the current one-action Listener', async ({ page }) => {
        const response = await page.request.post('/api/early-birds/test-login', {
            headers: {
                authorization: 'Bearer early-birds-e2e-login-secret-not-for-production',
                'x-forwarded-proto': 'https',
            },
            data: {
                email: 'listener@e2e.invalid',
                name: 'Synthetic Listener',
            },
        });
        expect(response.status()).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            landing: '/early-birds',
        });

        await page.goto('/listener');
        await expect(page.getByRole('heading', { name: 'Beacon' })).toBeAttached();
        await expect(page.getByRole('radio', { name: 'Con introducción' })).toBeVisible();
        await expect(page.getByRole('radio', { name: 'Solo Beacon' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Escuchar' })).toBeVisible();
        await page.locator('.listener-account > summary').click();
        await expect(page.getByText('Synthetic Listener')).toBeVisible();
        await expect(page.getByText('Acceso de prueba')).toBeVisible();
    });
});
