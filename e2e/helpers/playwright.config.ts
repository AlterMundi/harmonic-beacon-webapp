import { defineConfig, devices } from '@playwright/test';

// DOM/browser contracts intentionally live outside the full-stack testDir.
// Do not inherit the main config: these tests need no app, database or LiveKit.
export default defineConfig({
    testDir: './__tests__',
    testMatch: /\.spec\.ts$/,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: !!process.env.CI,
    timeout: 60_000,
    outputDir: '../../test-results/helpers',
    reporter: [['list']],
    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
