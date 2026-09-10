import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { requireAccountFixture } from './browser';
requireAccountFixture(); // Missing isolation is a hard failure, never a skip.
const results = process.env.E2E_ACCOUNT_RESULTS ?? path.resolve('test-results/account-fixture');
const chromiumLaunch = { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] };
export default defineConfig({
    testDir: '..',
    globalSetup: './preflight.ts',
    testMatch: ['tests/continuity-navigation.spec.ts', 'account-fixture/rp.spec.ts'],
    grep: /full-stack|Staff open drawer|Account RP/,
    forbidOnly: !!process.env.CI,
    workers: 1, fullyParallel: false, retries: 0, timeout: 90_000,
    expect: { timeout: 15_000 },
    outputDir: path.join(results, 'artifacts'),
    reporter: [['list'], ['json', { outputFile: path.join(results, 'report.json') }]],
    use: { baseURL: process.env.E2E_BASE_URL, ignoreHTTPSErrors: true, trace: 'retain-on-failure', screenshot: 'only-on-failure',
        locale: 'es-CR', timezoneId: 'America/Costa_Rica' },
    // Only the tagged native Staff drawer case is desktop-only. Mobile Account,
    // same-document, locale and media coverage remains mandatory (70 memberships).
    projects: [
        { name: 'chromium-account', use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunch } },
        { name: 'android-chrome-account', grepInvert: /@desktop-native-staff$/, use: { ...devices['Pixel 7'], launchOptions: chromiumLaunch } },
        { name: 'firefox-account', use: { ...devices['Desktop Firefox'], launchOptions: { args: [], firefoxUserPrefs: {
            'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true,
        } } } },
        { name: 'iphone-webkit-account', grepInvert: /@desktop-native-staff$/, use: { ...devices['iPhone 13'], launchOptions: { args: [] } } },
    ],
});
