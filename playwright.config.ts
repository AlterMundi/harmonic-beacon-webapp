import { defineConfig, devices } from '@playwright/test';
import { assertSafeFixtureDatabaseUrl } from './e2e/fixtures/database-url';

/**
 * Browser quality gates for Harmonic Beacon (issue #69, epic #64).
 *
 * Determinism rules:
 * - One worker, no retries locally: the shared fixture database makes
 *   parallelism unsafe and retries hide media-continuity regressions.
 * - Pinned locale/timezone so rendered dates and screenshots are stable.
 * - Viewport projects double as the responsive gate and the screenshot
 *   baseline matrix (1440 / 1024 / 390 / 320 px).
 *
 * The web server always boots with the pinned test pepper and the e2e
 * dashboard enabled; process env (E2E_*) wins over these defaults, and
 * these values always win over any developer `.env.local`, so the gates
 * can never silently run against a production database.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// Resolve the fixture database URL once so both the web server and tests
// that flip fixture state (e.g. opening doors by setting a session LIVE)
// talk to the same throwaway database.
const DATABASE_URL =
    process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/beacon_test';
assertSafeFixtureDatabaseUrl(DATABASE_URL);
if (!process.env.E2E_BASE_URL) {
    process.env.E2E_DATABASE_URL = DATABASE_URL;
}

/** Functional suites run once; responsive/visual suites run per width. */
const PER_WIDTH = /(responsive|visual)\.spec\.ts/;
const MEDIA_CONTINUITY = /media-continuity\.spec\.ts/;
const WEBKIT_ATTENDEE_CONTINUITY = /attendee controls without capture/;

export default defineConfig({
    testDir: './e2e/tests',
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    timeout: 60_000,
    expect: {
        timeout: 10_000,
        // Small tolerance absorbs font rasterization noise on a single
        // runner; surfaces under test contain no time-based content.
        toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
    },
    reporter: process.env.CI
        ? [['github'], ['html', { open: 'never' }]]
        : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: BASE_URL,
        locale: 'es-CR',
        timezoneId: 'America/Costa_Rica',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: {
            // Deterministic fake mic/camera for media-continuity tests.
            args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
            testIgnore: PER_WIDTH,
            grepInvert: WEBKIT_ATTENDEE_CONTINUITY,
        },
        {
            // Browser/device emulation is an early regression signal. It does
            // not replace the physical Android check in the rehearsal sheet.
            name: 'android-chrome',
            use: { ...devices['Pixel 7'] },
            testMatch: MEDIA_CONTINUITY,
            grepInvert: WEBKIT_ATTENDEE_CONTINUITY,
        },
        {
            // Playwright WebKit catches engine-specific autoplay and media
            // lifecycle failures. A real iPhone Safari remains the launch gate.
            name: 'iphone-webkit',
            use: {
                ...devices['iPhone 13'],
                // Chromium's fake-device CLI flags are not valid WebKit
                // options. Physical camera/microphone validation remains in
                // the rehearsal because Linux WebKit cannot grant those
                // browser permissions through Playwright.
                launchOptions: { args: [] },
            },
            testMatch: MEDIA_CONTINUITY,
            grep: WEBKIT_ATTENDEE_CONTINUITY,
        },
        {
            name: 'w1440',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
            testMatch: PER_WIDTH,
        },
        {
            name: 'w1024',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
            testMatch: PER_WIDTH,
        },
        {
            name: 'w390',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 390, height: 844 },
                isMobile: true,
                hasTouch: true,
            },
            testMatch: PER_WIDTH,
        },
        {
            name: 'w320',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 320, height: 568 },
                isMobile: true,
                hasTouch: true,
            },
            testMatch: PER_WIDTH,
        },
    ],
    // Point E2E_BASE_URL at an already-running stack to skip server startup.
    webServer: process.env.E2E_BASE_URL
        ? undefined
        : {
              // Production build, not dev: no HMR sockets, no dev-tools
              // chrome in screenshots, and the gate exercises what ships.
              command: `npm run build && npx next start --port ${PORT}`,
              // The landing renders (degraded) even without a database, so a
              // 200 here means "server up"; stack-dependent suites probe and
              // skip separately with a precise reason.
              url: BASE_URL,
              reuseExistingServer: !process.env.CI,
              timeout: 300_000,
              env: {
                  DATABASE_URL,
                  TICKET_CODE_PEPPER: 'test-fixture-pepper-not-for-production',
                  E2E_DASHBOARD_ENABLED: '1',
                  SESSION_COOKIE_TTL_SECONDS: '604800',
                  NEXT_PUBLIC_LIVEKIT_URL: process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880',
                  LIVEKIT_API_KEY: process.env.E2E_LIVEKIT_API_KEY ?? 'devkey',
                  LIVEKIT_API_SECRET: process.env.E2E_LIVEKIT_API_SECRET ?? 'secret',
                  LIVEKIT_ROOM_NAME: 'beacon',
              },
          },
});
