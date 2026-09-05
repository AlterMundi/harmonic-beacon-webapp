import { RoomServiceClient } from 'livekit-server-sdk';

import { expect, stackTest } from '../fixtures/stack';
import { loginViaDashboard } from '../fixtures/auth';
import {
    requireDirectDb,
    withReconciledPublicationGrant,
    withSessionStatus,
} from '../fixtures/db';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';

function roomService(): RoomServiceClient {
    const url = (process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880')
        .replace(/^ws:/, 'http:')
        .replace(/^wss:/, 'https:');
    return new RoomServiceClient(
        url,
        process.env.E2E_LIVEKIT_API_KEY ?? 'devkey',
        process.env.E2E_LIVEKIT_API_SECRET ?? 'secret',
    );
}

stackTest('a replayed room JWT can rejoin but cannot restore publication', async ({ page }, testInfo) => {
    stackTest.skip(testInfo.project.name !== 'chromium', 'one real-LiveKit browser proof is sufficient');
    const databaseUrl = requireDirectDb(testInfo);

    await withSessionStatus(databaseUrl, SESSION_ES.id, 'LIVE', () =>
        withReconciledPublicationGrant(databaseUrl, SESSION_ES.id, async () => {
        const issued = page.waitForResponse((response) =>
            response.request().method() === 'GET' &&
            new URL(response.url()).pathname ===
                `/api/scheduled-sessions/${SESSION_ES.id}/token`,
        );
        await loginViaDashboard(
            page,
            'FACILITATOR',
            'Replay Test Facilitator',
            ROUTES.session(SESSION_ES.id),
        );
        await expect(page.getByTestId('connection-state')).toHaveAttribute(
            'data-state',
            'connected',
            { timeout: 20_000 },
        );

        const issuedResponse = await issued;
        expect(issuedResponse.ok()).toBe(true);
        const credential = await issuedResponse.json() as {
            token: string;
            identity: string;
            room: string;
            displayName: string;
            role: string;
            isAssignedFacilitator: boolean;
            principalKind: string;
            session: Record<string, unknown>;
        };
        const livekit = roomService();
        await expect.poll(async () => (
            await livekit.getParticipant(SESSION_ES.roomName, credential.identity)
        ).permission?.canPublish, { timeout: 10_000 }).toBe(true);

        // Replay the exact signed credential while suppressing the separate
        // server-authorized activation request. The new connection replaces
        // the current identity, but the JWT itself carries no publish grant.
        await page.route(
            `**/api/scheduled-sessions/${SESSION_ES.id}/token*`,
            async (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ...credential,
                    canPublish: false,
                }),
            }),
        );
        await page.reload();
        await expect(page.getByTestId('connection-state')).toHaveAttribute(
            'data-state',
            'connected',
            { timeout: 20_000 },
        );
        await expect.poll(async () => (
            await livekit.getParticipant(SESSION_ES.roomName, credential.identity)
        ).permission?.canPublish, { timeout: 10_000 }).toBe(false);

        // Model the old final-sweep race: the identity is absent at the sweep,
        // then the still-unexpired credential completes its join afterwards.
        await livekit.removeParticipant(SESSION_ES.roomName, credential.identity);
        await expect.poll(async () => (
            await livekit.listParticipants(SESSION_ES.roomName)
        ).some(({ identity }) => identity === credential.identity)).toBe(false);
        await page.reload();
        await expect(page.getByTestId('connection-state')).toHaveAttribute(
            'data-state',
            'connected',
            { timeout: 20_000 },
        );
        await expect.poll(async () => (
            await livekit.getParticipant(SESSION_ES.roomName, credential.identity)
        ).permission?.canPublish, { timeout: 10_000 }).toBe(false);
        }),
    );
});
