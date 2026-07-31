import { expect, test as base } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/**
 * Two test objects:
 *
 * - `test` — public surfaces that render without the database (landing in
 *   its documented degraded state, staff login). Always runnable.
 * - `stackTest` — suites that need the full local stack: the app plus the
 *   fixture database restored from `db/test-fixture.sql`. When the stack is
 *   missing, every test skips with a precise reason instead of failing or
 *   silently weakening its assertions. See e2e/README.md for setup.
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
