import { expect, test as base } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/**
 * Two test objects:
 *
 * - `test` — public surfaces that render without the database (landing in
 *   its documented degraded state, staff login). Always runnable.
 * - `stackTest` — suites that need the full local stack: the app plus the
 *   fixture database restored from `db/test-fixture.sql`. CI fails closed
 *   when this required stack is missing. Locally, tests skip with a precise
 *   reason so public-only development remains possible. See e2e/README.md.
 */

export type StackStatus = 'ok' | 'unreachable';

export async function probeStack(request: APIRequestContext): Promise<StackStatus> {
    try {
        const ready = await request.get('/api/health/ready');
        if (!ready.ok()) {
            return 'unreachable';
        }
        // Test events are deliberately absent from public discovery. Do not
        // use landing-page HTML as a fixture probe: doing so would regress the
        // isTest boundary. Role helpers provide a precise fixture error when a
        // specific seeded record is missing.
        return 'ok';
    } catch {
        return 'unreachable';
    }
}

const SKIP_HINTS: Record<Exclude<StackStatus, 'ok'>, string> = {
    unreachable:
        'database unreachable — restore the fixture (see e2e/README.md) or set E2E_DATABASE_URL',
};

export const test = base;

export const stackTest = base.extend<{ stack: void }>({
    stack: [
        async ({ request }, use, testInfo) => {
            const status = await probeStack(request);
            if (process.env.CI && status !== 'ok') {
                throw new Error(
                    `CI requires a healthy E2E fixture stack (${status}): ${SKIP_HINTS[status]}`,
                );
            }
            testInfo.skip(
                status !== 'ok',
                `local e2e stack ${status}: ${status === 'ok' ? '' : SKIP_HINTS[status]}`,
            );
            await use();
        },
        { auto: true },
    ],
});

export { expect };
