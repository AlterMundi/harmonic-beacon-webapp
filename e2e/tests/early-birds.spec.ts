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
});
