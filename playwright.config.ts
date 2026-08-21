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
const LISTENER_ACCOUNT_SWITCH_GATE = process.env.E2E_LISTENER_ACCOUNT_SWITCH_GATE === '1';
const LISTENER_NETWORK_GATE = process.env.E2E_LISTENER_NETWORK_GATE === '1';
assertSafeFixtureDatabaseUrl(DATABASE_URL);
if (!process.env.E2E_BASE_URL) {
    process.env.E2E_DATABASE_URL = DATABASE_URL;
}

/** Functional suites run once; responsive/visual suites run per width. */
const PER_WIDTH = /(responsive|visual)\.spec\.ts/;
const MEDIA_CONTINUITY = /media-continuity\.spec\.ts/;
const LISTENER_NETWORK_RESILIENCE = /listener-network-resilience\.spec\.ts/;
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
        // The network gate serves hundreds of immutable media fragments. A
        // retained trace embeds every response body and can itself exhaust
        // Firefox/Playwright while reporting a failure. The gate has a bounded
        // purpose-built diagnostic ring and screenshots instead.
        trace: LISTENER_NETWORK_GATE ? 'off' : 'retain-on-failure',
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
            testMatch: [MEDIA_CONTINUITY, LISTENER_NETWORK_RESILIENCE],
            grepInvert: WEBKIT_ATTENDEE_CONTINUITY,
        },
        {
            // A second desktop engine catches focus, form, cookie and
            // navigation regressions that Chromium alone cannot expose. The
            // dedicated media-continuity matrix remains on Chromium/WebKit;
            // Firefox runs every other functional/accessibility suite.
            name: 'firefox',
            use: {
                ...devices['Desktop Firefox'],
                viewport: { width: 1440, height: 900 },
                launchOptions: {
                    args: [],
                    firefoxUserPrefs: {
                        'media.navigator.streams.fake': true,
                        'media.navigator.permission.disabled': true,
                    },
                },
            },
            testIgnore: [PER_WIDTH, MEDIA_CONTINUITY],
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
            testMatch: [MEDIA_CONTINUITY, LISTENER_NETWORK_RESILIENCE],
            grep: /attendee controls without capture|preserves the filled buffer/i,
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
                  // Explicitly enabled only inside the throwaway E2E stack;
                  // production templates and runtime default remain OFF.
                  PROMO_INVITATIONS_ENABLED: 'true',
                  E2E_DASHBOARD_ENABLED: '1',
                  SESSION_COOKIE_TTL_SECONDS: '604800',
                  NEXT_PUBLIC_LIVEKIT_URL: process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880',
                  LIVEKIT_API_KEY: process.env.E2E_LIVEKIT_API_KEY ?? 'devkey',
                  LIVEKIT_API_SECRET: process.env.E2E_LIVEKIT_API_SECRET ?? 'secret',
                  LIVEKIT_ROOM_NAME: 'beacon',
                  EARLY_BIRDS_ENABLED: '1',
                  EARLY_BIRDS_FREE_FOR_ALL: LISTENER_NETWORK_GATE ? '1' : '0',
                  EARLY_BIRDS_AUTH_SECRET: 'early-birds-e2e-auth-secret-not-for-production',
                  EARLY_BIRDS_AUTH_BASE_URL: BASE_URL,
                  EARLY_BIRDS_TRUSTED_ORIGINS: BASE_URL,
                  EARLY_BIRDS_TEST_ACCESS_ENABLED: '1',
                  EARLY_BIRDS_TEST_LOGIN_SECRET: 'early-birds-e2e-login-secret-not-for-production',
                  EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED: '1',
                  EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS: `localhost:${PORT}`,
                  // This opt-in gate gets a separate server process so the
                  // regular visual suite keeps its existing Account-off UI.
                  ...(LISTENER_ACCOUNT_SWITCH_GATE ? {
                      BEACON_LISTENER_ACCOUNT_ENABLED: '1',
                      BEACON_LISTENER_ACCOUNT_ENVIRONMENT: 'production',
                      BEACON_LISTENER_ACCOUNT_CLIENT_SECRET:
                          'listener-account-e2e-client-secret-not-for-production',
                      BEACON_LISTENER_ACCOUNT_STATE_SECRET:
                          'listener-account-e2e-state-secret-not-for-production',
                  } : {}),
              },
          },
});
