import { expect, test } from '@playwright/test';

test.describe('EarlyBird Listener boundary', () => {
    test('serves the bilingual public landing without exposing test access', async ({ page }) => {
        await page.goto('/early-birds');
        await expect(page.getByRole('heading', { name: 'El Beacon, siempre presente.' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Continuar con Google/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Continuar con Apple/ })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Entrar con acceso de prueba' })).toHaveCount(0);
    });

    test('redirects an unauthenticated listener away from the private home', async ({ page }) => {
        await page.goto('/early-birds/home');
        await expect(page).toHaveURL(/\/early-birds$/);
        await expect(page.getByRole('heading', { name: 'El Beacon, siempre presente.' })).toBeVisible();
    });

    test('creates an isolated synthetic session and reaches the private Listener home', async ({ page }) => {
        const response = await page.request.post('/api/early-birds/test-login', {
            headers: {
                authorization: 'Bearer early-birds-e2e-login-secret-not-for-production',
            },
            data: {
                email: 'listener@e2e.invalid',
                name: 'Synthetic Listener',
            },
        });
        expect(response.status()).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            landing: '/early-birds/home',
        });

        await page.goto('/early-birds/home');
        await expect(page.getByText('Synthetic Listener')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Beacon 24/7' })).toBeVisible();
        await expect(page.getByText(/Membresía activa · TEST/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Escuchar ahora' })).toBeVisible();
    });
});
