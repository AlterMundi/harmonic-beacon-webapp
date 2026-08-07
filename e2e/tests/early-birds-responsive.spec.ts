import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const MEDIA_PATH = /\/api\/(?:early-birds\/(?:stream|drop-ins)|listener\/(?:stream|drop-ins))|\.(?:m3u8|m4a|aac|mp3|ogg|wav)(?:[?#]|$)/i;
const PROJECT_IP: Record<string, string> = {
    w1440: '198.51.100.10',
    w1024: '198.51.100.11',
    w390: '198.51.100.12',
    w320: '198.51.100.13',
};

async function expectNoHorizontalScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'Listener page has horizontal overflow').toBeLessThanOrEqual(1);
}

async function expectAccessible(page: Page, testInfo: TestInfo, surface: string): Promise<void> {
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const blocking = results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    );
    await testInfo.attach(`${surface}-axe`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
    });
    expect(blocking, blocking.map((violation) => (
        `${violation.id}: ${violation.help} (${violation.nodes.length})`
    )).join('\n')).toEqual([]);
}

async function expectTouchTarget(target: Locator, name: string): Promise<void> {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box, `${name} has no layout box`).not.toBeNull();
    expect(box!.height, `${name} is shorter than 44 CSS px`).toBeGreaterThanOrEqual(44);
    expect(box!.width, `${name} is narrower than 44 CSS px`).toBeGreaterThanOrEqual(44);
}

test.describe('Listener responsive and accessibility boundary', () => {
    test.beforeEach(async ({ page }) => {
        await page.setExtraHTTPHeaders({ 'x-forwarded-proto': 'https' });
    });

    test('public entry is in bounds, accessible and requests no media before authorization', async ({ page }, testInfo) => {
        const mediaRequests: string[] = [];
        page.on('request', (request) => {
            if (MEDIA_PATH.test(new URL(request.url()).pathname)) mediaRequests.push(request.url());
        });

        await page.goto('/listener');
        await expect(page.getByRole('heading', { name: 'Recuerda tu centro armónico.' })).toBeVisible();
        await expectTouchTarget(page.getByRole('link', { name: 'Entrar al Beacon' }), 'Entrar al Beacon');
        await expectNoHorizontalScroll(page);
        await expect(page.locator('audio, video')).toHaveCount(0);
        expect(mediaRequests).toEqual([]);
        await expectAccessible(page, testInfo, 'listener-public');
    });

    test('authorized one-action Listener stays in bounds with accessible touch targets', async ({ page }, testInfo) => {
        const response = await page.request.post('/api/early-birds/test-login', {
            headers: {
                authorization: 'Bearer early-birds-e2e-login-secret-not-for-production',
                'x-forwarded-proto': 'https',
                'x-forwarded-for': PROJECT_IP[testInfo.project.name] ?? '198.51.100.20',
            },
            data: {
                email: `responsive-listener-${testInfo.project.name}@e2e.invalid`,
                name: 'Responsive Listener',
            },
        });
        expect(response.status()).toBe(200);

        await page.goto('/listener');
        await expect(page.getByRole('heading', { name: 'Beacon' })).toBeAttached();
        await expectNoHorizontalScroll(page);
        const account = page.locator('.listener-account > summary');
        await expect(account).toHaveAttribute('aria-label', 'Cuenta');
        await expectTouchTarget(account, 'Cuenta');
        await expectAccessible(page, testInfo, 'listener-authorized');
    });
});
