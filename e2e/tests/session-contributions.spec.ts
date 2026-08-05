import { expect, stackTest } from '../fixtures/stack';
import { loginAttendeeWithTicket } from '../fixtures/auth';
import { SESSION_ES, TICKETS } from '../fixtures/test-data';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import {
    expectMediaContinuity,
    installMediaProbe,
    mediaProbeSnapshot,
} from '../helpers/media-probe';

/**
 * CHAT-01 UI (#141, PR B): the questions-and-emotions chat end to end, in
 * real browsers against the real API.
 *
 * Test 1 proves the multiuser contract: two ticket holders in the same
 * session see each other's contributions through the public feed, NAMED
 * shows the author display name and ANONYMOUS shows the localized
 * "Anónimo" label while the author stays hidden from the room.
 *
 * Test 2 proves the retry/idempotency UX: a failed POST keeps the draft in
 * the composer, the retry reuses the same idempotency key (unit-level proof
 * lives in SessionContributions.test.tsx), and the feed never shows the
 * message twice.
 *
 * Test 3 is the media-continuity guard from the report: using the chat
 * panel (compose, send, collapse, expand) must not disturb the audio/scene
 * pipeline. It reuses the TAP media probe and skips precisely when LiveKit
 * is unreachable, like the canonical continuity suite.
 *
 * Doors must be open while attendees enter: stage tokens only flow for LIVE
 * sessions (src/lib/room-entitlement.ts).
 */

const LIVEKIT_URL = process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880';

const ATTENDEE_A = {
    name: 'E2E Attendee',
    email: 'e2e.attendee@altermundi.net',
    code: TICKETS.esIssuedA,
} as const;

const ATTENDEE_B = {
    name: 'Asistente E2E',
    email: 'asistente@altermundi.net',
    code: TICKETS.esBound.code,
} as const;

async function livekitReachable(): Promise<boolean> {
    const httpUrl = LIVEKIT_URL.replace(/^ws/, 'http');
    try {
        const response = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function joinAttendee(
    browser: import('@playwright/test').Browser,
    credentials: { name: string; email: string; code: string },
) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAttendeeWithTicket(page, credentials);
    await page.waitForURL(`**/session/${SESSION_ES.id}`);
    const panel = page.getByTestId('session-contributions');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    return { context, page, panel };
}

stackTest.describe('session contributions chat (#141)', () => {
    stackTest('two attendees see each other; anonymous hides the author from the room', async ({
        browser,
    }, testInfo) => {
        stackTest.slow();
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
            const a = await joinAttendee(browser, ATTENDEE_A);
            const b = await joinAttendee(browser, ATTENDEE_B);
            try {
                // A shares NAMED: B sees the body with A's display name.
                // Author assertions are scoped to the feed list: the composer
                // (button + anonymity note) and the room header also carry
                // matching strings.
                const namedBody = `pregunta pública e2e ${Date.now()}`;
                await a.panel.getByRole('textbox').fill(namedBody);
                await a.panel.getByRole('button', { name: 'Compartir', exact: true }).click();
                const feedB = b.panel.getByTestId('contributions-feed');
                await expect(feedB.getByText(namedBody)).toBeVisible({ timeout: 15_000 });
                await expect(feedB.getByText(ATTENDEE_A.name)).toBeVisible();

                // B shares ANONYMOUS: A sees the localized anonymous label and
                // never B's real name inside the panel.
                const anonBody = `emoción anónima e2e ${Date.now()}`;
                await b.panel.getByRole('textbox').fill(anonBody);
                await b.panel.getByRole('button', { name: 'Compartir anónimo' }).click();
                const feedA = a.panel.getByTestId('contributions-feed');
                await expect(feedA.getByText(anonBody)).toBeVisible({ timeout: 15_000 });
                await expect(feedA.getByText('Anónimo', { exact: true })).toBeVisible();
                await expect(a.panel.getByText(ATTENDEE_B.name)).toHaveCount(0);
            } finally {
                await a.context.close();
                await b.context.close();
            }
        });
    });

    stackTest('a failed send keeps the draft and the retry never duplicates the message', async ({
        browser,
    }, testInfo) => {
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
            const a = await joinAttendee(browser, ATTENDEE_A);
            try {
                // The first POST fails at the network edge; everything else flows.
                let failNextPost = true;
                await a.page.route('**/api/scheduled-sessions/*/contributions*', async (route) => {
                    if (route.request().method() === 'POST' && failNextPost) {
                        failNextPost = false;
                        await route.fulfill({ status: 500, body: 'edge failure' });
                        return;
                    }
                    await route.continue();
                });

                const body = `mensaje con reintento e2e ${Date.now()}`;
                const composer = a.panel.getByRole('textbox');
                await composer.fill(body);
                await a.panel.getByRole('button', { name: 'Compartir', exact: true }).click();

                // Recoverable error: the draft is still there.
                await expect(a.panel.getByText(/No se pudo publicar/)).toBeVisible();
                await expect(composer).toHaveValue(body);

                // Retry (same idempotency key) succeeds exactly once.
                await a.panel.getByRole('button', { name: 'Compartir', exact: true }).click();
                await expect(composer).toHaveValue('', { timeout: 10_000 });
                await expect(a.panel.getByText(body)).toHaveCount(1, { timeout: 15_000 });
            } finally {
                await a.context.close();
            }
        });
    });

    stackTest('using the chat panel never disturbs the audio/scene pipeline', async ({
        browser,
    }, testInfo) => {
        testInfo.skip(
            !(await livekitReachable()),
            `LiveKit not reachable at ${LIVEKIT_URL} — start the dev server (see e2e/README.md) or set E2E_LIVEKIT_URL`,
        );
        stackTest.slow();
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
            const context = await browser.newContext();
            const page = await context.newPage();
            try {
                await installMediaProbe(page);
                await loginAttendeeWithTicket(page, ATTENDEE_A);
                await page.waitForURL(`**/session/${SESSION_ES.id}`);
                await expect(page.getByTestId('connection-state')).toHaveAttribute(
                    'data-state',
                    'connected',
                    { timeout: 30_000 },
                );
                await page.getByRole('button', { name: /Start audio|Iniciar audio/i }).click();

                // Baseline: let the media pipeline settle before touching the
                // chat (same stable-read discipline as the canonical
                // continuity suite: counters frozen for 4 consecutive reads).
                let baseline = await mediaProbeSnapshot(page);
                let stableReads = 0;
                for (let attempt = 0; attempt < 20 && stableReads < 4; attempt += 1) {
                    await page.waitForTimeout(250);
                    const current = await mediaProbeSnapshot(page);
                    const unchanged =
                        current.audioElements === baseline.audioElements &&
                        current.videoElements === baseline.videoElements &&
                        current.playCalls === baseline.playCalls &&
                        current.mediaElementsAttached === baseline.mediaElementsAttached &&
                        current.mediaElementsRemoved === baseline.mediaElementsRemoved;
                    stableReads = unchanged ? stableReads + 1 : 0;
                    baseline = current;
                }

                // Exercise the panel: compose, send, collapse, expand.
                const panel = page.getByTestId('session-contributions');
                await panel.getByRole('textbox').fill(`chat durante audio e2e ${Date.now()}`);
                await panel.getByRole('button', { name: 'Compartir', exact: true }).click();
                await expect(panel.getByRole('textbox')).toHaveValue('', { timeout: 10_000 });
                await panel.getByRole('button', { name: /Contraer|Collapse/i }).click();
                await page.waitForTimeout(500);
                await panel.getByRole('button', { name: /Expandir|Expand/i }).click();
                await page.waitForTimeout(2_500);

                expectMediaContinuity(baseline, await mediaProbeSnapshot(page));
            } finally {
                await context.close();
            }
        });
    });
});
