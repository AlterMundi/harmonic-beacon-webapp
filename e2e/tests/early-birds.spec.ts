import { expect, test } from '@playwright/test';

test.describe('EarlyBird Listener boundary', () => {
    test('serves the bilingual public landing without exposing test access', async ({ page }) => {
        await page.goto('/early-birds');
        await expect(page.getByRole('heading', { name: 'El Beacon, siempre presente.' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Continuar con Google/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Continuar con Apple/ })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Entrar con acceso de prueba' })).toHaveCount(0);
    });

    test('keeps the legacy private-home URL as a compatibility redirect', async ({ page }) => {
        await page.goto('/early-birds/home');
        await expect(page).toHaveURL(/\/early-birds$/);
        await expect(page.getByRole('heading', { name: 'El Beacon, siempre presente.' })).toBeVisible();
    });

    test('shows the team form only on the exact HTTPS staging host and never persists its code', async ({ page }) => {
        const accessCode = 'browser-entered-staging-code-000000000001';
        await page.setExtraHTTPHeaders({ 'x-forwarded-proto': 'https' });
        let authorization = '';
        await page.route('**/api/early-birds/test-login', async (route) => {
            authorization = route.request().headers().authorization ?? '';
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Synthetic login failed.' }),
            });
        });

        await page.goto('/early-birds');
        await expect(page.getByText('Acceso de equipo · staging')).toBeVisible();
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

    test('creates an isolated synthetic session and reaches the private Listener home', async ({ page }) => {
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

        await page.goto('/early-birds');
        await expect(page.getByText('Synthetic Listener')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Beacon' })).toBeAttached();
        await expect(page.getByText(/Membresía activa · TEST/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Play con intro' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Play · solo Beacon' })).toBeVisible();
    });
});
