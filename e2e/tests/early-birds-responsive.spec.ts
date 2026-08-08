import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const MEDIA_PATH = /\/api\/(?:early-birds\/(?:stream|drop-ins)|listener\/(?:stream|drop-ins))|\.(?:m3u8|m4s|m4a|aac|mp3|ogg|wav)(?:[?#]|$)/i;
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
        // One clear contextual primary action: the hero entry CTA, with no
        // competing primary action inside the anonymous access card.
        await expect(page.locator('.listener-public-hero__cta')).toHaveCount(1);
        await expect(page.locator('.listener-access__card .listener-button--primary')).toHaveCount(0);
        await expect(page.locator('audio, video')).toHaveCount(0);
        expect(mediaRequests).toEqual([]);
        await expectAccessible(page, testInfo, 'listener-public');
    });

    test('public access controls keep the 44px touch floor', async ({ page }) => {
        await page.goto('/listener');
        const stagingSubmit = page.getByRole('button', { name: /staging/i });
        test.skip(
            await stagingSubmit.count() === 0,
            'staging team entry surface is not enabled in this stack',
        );
        await expectTouchTarget(stagingSubmit, 'staging entry submit');
        await expectTouchTarget(
            page.getByLabel(/Cuenta sintética|Synthetic account/i),
            'synthetic account input',
        );
    });

    test('reduced motion removes nonessential Listener animation', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/listener');
        await expect(page.getByRole('heading', { name: 'Recuerda tu centro armónico.' })).toBeVisible();

        for (const selector of [
            '.listener-field__aurora',
            '.listener-field__orbit--outer',
            '.listener-field__orbit--inner',
            '.listener-field__core',
            '.listener-field__point',
        ]) {
            const animationName = await page.locator(selector).first().evaluate(
                (element) => getComputedStyle(element).animationName,
            );
            expect(animationName, `${selector} still animates under reduced motion`).toBe('none');
        }

        const looping = await page.evaluate(() => {
            const names: string[] = [];
            document.querySelectorAll('*').forEach((element) => {
                const style = getComputedStyle(element);
                if (
                    style.animationName !== 'none'
                    && style.animationIterationCount === 'infinite'
                    && style.animationPlayState === 'running'
                ) {
                    names.push(`${element.tagName}.${String(element.className)}`);
                }
            });
            return names;
        });
        expect(looping, 'nonessential looping animation survives reduced motion').toEqual([]);
    });

    test.describe('explicit English browser language', () => {
        test.use({ locale: 'en-US' });

        test('renders the English Listener with no media before authorization', async ({ page }, testInfo) => {
            const mediaRequests: string[] = [];
            page.on('request', (request) => {
                if (MEDIA_PATH.test(new URL(request.url()).pathname)) mediaRequests.push(request.url());
            });

            await page.goto('/listener');
            await expect(page.getByRole('heading', { name: 'Remember your harmonic center.' })).toBeVisible();
            // <html lang> is only browser-derived on the canonical listener
            // host (root layout); the preview host keeps the event default, so
            // the English evidence here is the rendered Listener copy itself.
            await expectTouchTarget(page.getByRole('link', { name: 'Enter the Beacon' }), 'Enter the Beacon');
            await expectNoHorizontalScroll(page);
            await expect(page.locator('audio, video')).toHaveCount(0);
            expect(mediaRequests).toEqual([]);
            await expectAccessible(page, testInfo, 'listener-public-en');
        });
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

        // One clear contextual primary action in the ready state.
        await expect(page.locator('.listener-experience')).toHaveAttribute('data-phase', 'ready');
        const primary = page.locator('.listener-transport__primary');
        await expect(primary).toHaveCount(1);
        await expect(primary).toBeEnabled();
        await expect(primary).toHaveAccessibleName('Escuchar');
        await expectTouchTarget(primary, 'Escuchar');
        await expectAccessible(page, testInfo, 'listener-authorized');
    });
});
