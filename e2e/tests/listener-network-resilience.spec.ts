import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

const execFileAsync = promisify(execFile);
const STREAM_ORIGIN = 'https://stream.e2e.invalid';
const MEDIA_SEGMENT_SECONDS = 6;
const SOURCE_WINDOW_SEGMENTS = 50;
// Browsers may retain a sub-frame tail in TimeRanges after the decoder clock
// has genuinely stalled. Half a second is still two orders of magnitude below
// the promised reservoir and prevents pretending that millisecond rounding is
// audible continuity.
const EXHAUSTED_MEDIA_TOLERANCE_SECONDS = 0.5;

type HlsFixture = {
    root: string;
    initialization: string;
    segments: string[];
};

async function createHlsFixture(): Promise<HlsFixture> {
    const root = await mkdtemp(path.join(tmpdir(), 'hb-listener-network-'));
    await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', 'sine=frequency=440:sample_rate=48000',
        '-t', String(MEDIA_SEGMENT_SECONDS * SOURCE_WINDOW_SEGMENTS),
        '-c:a', 'aac',
        '-b:a', '64k',
        '-f', 'hls',
        '-hls_time', String(MEDIA_SEGMENT_SECONDS),
        '-hls_list_size', '0',
        '-hls_segment_type', 'fmp4',
        '-hls_fmp4_init_filename', 'init.mp4',
        '-hls_segment_filename', path.join(root, '%05d.m4s'),
        path.join(root, 'source.m3u8'),
    ]);
    const manifest = await readFile(path.join(root, 'source.m3u8'), 'utf8');
    const initialization = /#EXT-X-MAP:URI="([^"]+)"/.exec(manifest)?.[1];
    const generatedSegments = manifest.split('\n').filter((line) => /^\d{5}\.m4s$/.test(line));
    // ffmpeg may emit one final encoder-drain fragment after the exact 300s
    // boundary. The test window deliberately uses only fifty full segments.
    const segments = generatedSegments.slice(0, SOURCE_WINDOW_SEGMENTS);
    if (!initialization || segments.length !== SOURCE_WINDOW_SEGMENTS) {
        throw new Error(`unexpected HLS fixture inventory: ${generatedSegments.length}`);
    }
    return { root, initialization, segments };
}

function renderLiveManifest(fixture: HlsFixture, edgeSequence: number): string {
    const firstSequence = Math.max(0, edgeSequence - (SOURCE_WINDOW_SEGMENTS - 1));
    const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        `#EXT-X-TARGETDURATION:${MEDIA_SEGMENT_SECONDS}`,
        `#EXT-X-MEDIA-SEQUENCE:${firstSequence}`,
        '#EXT-X-INDEPENDENT-SEGMENTS',
        `#EXT-X-MAP:URI="${fixture.initialization}"`,
    ];
    for (let sequence = firstSequence; sequence <= edgeSequence; sequence += 1) {
        const index = sequence % fixture.segments.length;
        if (index === 0 && sequence !== 0) lines.push('#EXT-X-DISCONTINUITY');
        lines.push(`#EXTINF:${MEDIA_SEGMENT_SECONDS.toFixed(6)},`);
        lines.push(fixture.segments[index]);
    }
    return `${lines.join('\n')}\n`;
}

async function mediaState(page: import('@playwright/test').Page) {
    return page.locator('audio[aria-label="Beacon"]').evaluate((media: HTMLAudioElement) => {
        let bufferedAheadSeconds = 0;
        for (let index = 0; index < media.buffered.length; index += 1) {
            const start = media.buffered.start(index);
            const end = media.buffered.end(index);
            if (media.currentTime >= start - 0.25 && media.currentTime <= end + 0.25) {
                bufferedAheadSeconds = Math.max(0, end - media.currentTime);
                break;
            }
        }
        return {
            currentTime: media.currentTime,
            bufferedAheadSeconds,
            paused: media.paused,
            ended: media.ended,
            readyState: media.readyState,
            errorCode: media.error?.code ?? null,
            playbackRate: media.playbackRate,
        };
    });
}

async function retainedReservoirSeconds(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(() => {
        const diagnostics = (window as typeof window & { __hbNetworkDiagnostics?: unknown[] })
            .__hbNetworkDiagnostics ?? [];
        let retainedSeconds = 0;
        for (const diagnostic of diagnostics) {
            if (!diagnostic || typeof diagnostic !== 'object') continue;
            const value = (diagnostic as { reservoirAheadSeconds?: unknown }).reservoirAheadSeconds;
            if (typeof value === 'number' && Number.isFinite(value)) {
                retainedSeconds = Math.max(retainedSeconds, value);
            }
        }
        return retainedSeconds;
    });
}

async function reservoirSnapshotCount(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(() => (
        ((window as typeof window & { __hbNetworkDiagnostics?: Array<{ reason?: unknown }> })
            .__hbNetworkDiagnostics ?? [])
            .filter((diagnostic) => diagnostic?.reason === 'reservoir-ready').length
    ));
}

async function lastRecoveryBufferedAheadSeconds(
    page: import('@playwright/test').Page,
): Promise<number | null> {
    return page.evaluate(() => {
        const diagnostics = (window as typeof window & { __hbNetworkDiagnostics?: unknown[] })
            .__hbNetworkDiagnostics ?? [];
        for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
            const diagnostic = diagnostics[index];
            if (!diagnostic || typeof diagnostic !== 'object') continue;
            const record = diagnostic as {
                reason?: unknown;
                media?: { bufferedAheadSeconds?: unknown };
            };
            if (![
                'media-clock-stalled',
                'paused-unexpectedly',
                'ended-unexpectedly',
                'media-error',
            ].includes(String(record.reason))) continue;
            const value = record.media?.bufferedAheadSeconds;
            return typeof value === 'number' && Number.isFinite(value) ? value : null;
        }
        return null;
    });
}

test.describe('Listener network resilience', () => {
    test.skip(process.env.E2E_LISTENER_NETWORK_GATE !== '1', 'focused network gate is opt-in');
    test.slow();

    let fixture: HlsFixture;

    test.beforeAll(async () => {
        fixture = await createHlsFixture();
    });

    test.afterAll(async () => {
        if (fixture?.root) await rm(fixture.root, { recursive: true, force: true });
    });

    test('preserves the filled buffer through outages and refills without a new lease', async ({
        page,
        browserName,
    }, testInfo) => {
        test.setTimeout(browserName === 'webkit' ? 420_000 : 360_000);
        const sourceStartedAt = Date.now();
        let originOnline = true;
        let originDelayMs = 0;
        let failEveryMediaRequest = 0;
        let leaseRequests = 0;
        let heartbeatRequests = 0;
        let manifestRequests = 0;
        let mediaRequests = 0;
        const diagnosticEvents: unknown[] = [];

        await page.addInitScript(() => {
            (window as typeof window & { __hbNetworkDiagnostics?: unknown[] })
                .__hbNetworkDiagnostics = [];
            window.addEventListener('listener:playback-diagnostic', (event) => {
                (window as typeof window & { __hbNetworkDiagnostics: unknown[] })
                    .__hbNetworkDiagnostics.push((event as CustomEvent).detail);
            });
        });
        await page.route(`${STREAM_ORIGIN}/**`, async (route) => {
            if (!originOnline) {
                await route.abort('internetdisconnected');
                return;
            }
            const url = new URL(route.request().url());
            const file = path.basename(url.pathname);
            if (file === 'live.m3u8') {
                manifestRequests += 1;
                const elapsedMediaSeconds = (Date.now() - sourceStartedAt) / 1_000 * 4;
                const edgeSequence = SOURCE_WINDOW_SEGMENTS - 1
                    + Math.floor(elapsedMediaSeconds / MEDIA_SEGMENT_SECONDS);
                await route.fulfill({
                    status: 200,
                    contentType: 'application/vnd.apple.mpegurl',
                    headers: {
                        'access-control-allow-origin': '*',
                        'cache-control': 'no-store',
                    },
                    body: renderLiveManifest(fixture, edgeSequence),
                });
                return;
            }
            const safeFile = file === fixture.initialization || fixture.segments.includes(file);
            if (!safeFile) {
                await route.fulfill({ status: 404, body: '' });
                return;
            }
            mediaRequests += 1;
            if (failEveryMediaRequest > 0 && mediaRequests % failEveryMediaRequest === 0) {
                await route.abort('connectionreset');
                return;
            }
            if (originDelayMs > 0) {
                const deterministicJitterMs = (mediaRequests % 5) * 75;
                await new Promise((resolve) => setTimeout(resolve, originDelayMs + deterministicJitterMs));
            }
            await route.fulfill({
                status: 200,
                contentType: file.endsWith('.mp4') ? 'video/mp4' : 'video/iso.segment',
                headers: {
                    'access-control-allow-origin': '*',
                    'cache-control': 'public, max-age=31536000, immutable',
                },
                body: await readFile(path.join(fixture.root, file)),
            });
        });

        const lease = {
            leaseId: '00000000-0000-4000-8000-000000000419',
            leaseGeneration: 1,
            presenceSequence: 0,
            leaseExpiresAt: '2099-08-20T23:59:00.000Z',
            stream: {
                manifestUrl: `${STREAM_ORIGIN}/approved/live.m3u8?grantId=${'a'.repeat(64)}&grant=${'b'.repeat(43)}`,
                expiresAt: '2099-08-20T23:59:00.000Z',
            },
        };
        await page.route('**/api/early-birds/stream/lease', async (route) => {
            leaseRequests += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lease) });
        });
        await page.route('**/api/early-birds/stream/heartbeat', async (route) => {
            heartbeatRequests += 1;
            const body = route.request().postDataJSON() as { presenceSequence?: number } | null;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ...lease,
                    presenceSequence: body?.presenceSequence ?? 0,
                }),
            });
        });

        await page.goto('/early-birds');
        const listen = page.getByRole('button', { name: /Listen|Escuchar/ });
        await expect(listen).toBeEnabled({ timeout: 20_000 });
        await listen.click();
        await expect(page.getByRole('button', { name: /Stop|Detener/ })).toBeVisible();

        await expect.poll(async () => retainedReservoirSeconds(page), {
            timeout: 90_000,
            message: `${browserName} did not fill the promised Listener buffer`,
        }).toBeGreaterThanOrEqual(180);
        await expect.poll(async () => (await mediaState(page)).bufferedAheadSeconds, {
            timeout: 20_000,
            message: `${browserName} did not make retained audio immediately playable`,
        }).toBeGreaterThan(5);
        const achievedBufferSeconds = await retainedReservoirSeconds(page);
        await page.locator('audio[aria-label="Beacon"]').evaluate((media: HTMLAudioElement) => {
            media.playbackRate = 4;
        });

        const outageDurations = [5, 15, 30, 60];
        for (const outageMediaSeconds of outageDurations) {
            const before = await mediaState(page);
            originOnline = false;
            await expect.poll(async () => (await mediaState(page)).currentTime - before.currentTime, {
                timeout: Math.ceil(outageMediaSeconds / 4 * 1_000) + 15_000,
                message: `${browserName} stopped inside a ${outageMediaSeconds}s buffered outage`,
            }).toBeGreaterThanOrEqual(outageMediaSeconds);
            const during = await mediaState(page);
            expect(during.paused).toBe(false);
            expect(during.ended).toBe(false);
            expect(during.errorCode).toBeNull();
            await expect(page.getByRole('button', { name: /Stop|Detener/ })).toBeVisible();

            originOnline = true;
            const snapshotsBeforeRefill = await reservoirSnapshotCount(page);
            const manifestsBeforeRefill = manifestRequests;
            await page.evaluate(() => window.dispatchEvent(new Event('online')));
            await expect.poll(() => manifestRequests, {
                timeout: 20_000,
                message: `${browserName} did not refresh its manifest after reconnecting`,
            }).toBeGreaterThan(manifestsBeforeRefill);
            await expect.poll(async () => reservoirSnapshotCount(page), {
                timeout: 30_000,
                message: `${browserName} did not complete a reservoir refill`,
            }).toBeGreaterThan(snapshotsBeforeRefill);
            await expect.poll(async () => retainedReservoirSeconds(page), {
                timeout: 45_000,
                message: `${browserName} did not refill after a ${outageMediaSeconds}s outage`,
            }).toBeGreaterThanOrEqual(180);
            await expect(page.locator('.listener-experience[data-phase="beacon"]'))
                .toBeVisible({ timeout: 20_000 });
        }

        // Latency, deterministic jitter and intermittent segment loss must
        // consume/refill the same buffer without replacing the lease.
        await page.locator('audio[aria-label="Beacon"]').evaluate((media: HTMLAudioElement) => {
            media.playbackRate = 1;
        });
        originDelayMs = 250;
        failEveryMediaRequest = 9;
        const degradedStarted = (await mediaState(page)).currentTime;
        await expect.poll(async () => (await mediaState(page)).currentTime - degradedStarted, {
            timeout: 35_000,
            message: `${browserName} stopped under latency, jitter and intermittent loss`,
        }).toBeGreaterThanOrEqual(15);
        expect((await mediaState(page)).paused).toBe(false);
        originDelayMs = 0;
        failEveryMediaRequest = 0;
        const degradedSnapshots = await reservoirSnapshotCount(page);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(async () => reservoirSnapshotCount(page), { timeout: 30_000 })
            .toBeGreaterThan(degradedSnapshots);
        await page.locator('audio[aria-label="Beacon"]').evaluate((media: HTMLAudioElement) => {
            media.playbackRate = 4;
        });
        await expect.poll(async () => retainedReservoirSeconds(page), {
            timeout: 45_000,
        }).toBeGreaterThanOrEqual(180);

        // Exercise the actual achieved limit rather than assuming the config
        // equals buffered media. Leave ten seconds in reserve so the assertion
        // proves continuous playback without intentionally exhausting it.
        const nearLimit = await mediaState(page);
        const retainedNearLimitSeconds = await retainedReservoirSeconds(page);
        const nearLimitOutageSeconds = Math.max(60, Math.floor(retainedNearLimitSeconds - 10));
        originOnline = false;
        await expect.poll(async () => (await mediaState(page)).currentTime - nearLimit.currentTime, {
            timeout: Math.ceil(nearLimitOutageSeconds / 4 * 1_000) + 20_000,
            message: `${browserName} did not preserve playback near its measured buffer limit`,
        }).toBeGreaterThanOrEqual(nearLimitOutageSeconds);
        expect((await mediaState(page)).paused).toBe(false);
        originOnline = true;
        const nearLimitSnapshots = await reservoirSnapshotCount(page);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(async () => reservoirSnapshotCount(page), { timeout: 30_000 })
            .toBeGreaterThan(nearLimitSnapshots);
        await expect.poll(async () => retainedReservoirSeconds(page), {
            timeout: 60_000,
        }).toBeGreaterThanOrEqual(180);
        await expect(page.locator('.listener-experience[data-phase="beacon"]'))
            .toBeVisible({ timeout: 20_000 });

        // Once the measured buffer is genuinely exhausted the UI may switch
        // to reconnecting, but it must keep trying and resume without a new
        // lease or a manual reload when the origin returns.
        const beforeExhaustion = await mediaState(page);
        const retainedBeforeExhaustion = await retainedReservoirSeconds(page);
        originOnline = false;
        const exhaustionDeadline = Date.now()
            // MediaSource and the memory reservoir can hold partially distinct
            // fragments. Their sum is a conservative upper bound; using only
            // the larger value races WebKit while it is still consuming valid
            // bytes from the other layer.
            + Math.ceil((
                beforeExhaustion.bufferedAheadSeconds
                + retainedBeforeExhaustion
            ) / 4 * 1_000)
            + 45_000;
        let maxCurrentTime = beforeExhaustion.currentTime;
        let exhaustedState: Awaited<ReturnType<typeof mediaState>> | null = null;
        while (Date.now() < exhaustionDeadline) {
            const state = await mediaState(page);
            maxCurrentTime = Math.max(maxCurrentTime, state.currentTime);
            const phase = await page.locator('.listener-experience').getAttribute('data-phase');
            if (phase === 'reconnecting') {
                exhaustedState = state;
                break;
            }
            await page.waitForTimeout(250);
        }
        expect(exhaustedState, `${browserName} did not enter reconnecting after exhausting retained audio`)
            .not.toBeNull();
        expect(await lastRecoveryBufferedAheadSeconds(page))
            .toBeLessThanOrEqual(EXHAUSTED_MEDIA_TOLERANCE_SECONDS);
        expect(maxCurrentTime - beforeExhaustion.currentTime)
            .toBeGreaterThanOrEqual(Math.max(0, beforeExhaustion.bufferedAheadSeconds - 5));
        await expect(page.locator('.listener-experience[data-phase="reconnecting"]'))
            .toBeVisible();
        const reconnectingObservedAt = Date.now();
        await expect(page.getByText(/unavailable right now|no está disponible/i)).toHaveCount(0);
        originOnline = true;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(page.locator('.listener-experience[data-phase="beacon"]'))
            .toBeVisible({ timeout: 45_000 });
        await expect(page.getByRole('button', { name: /Stop|Detener/ })).toBeVisible();
        const resumedAt = (await mediaState(page)).currentTime;
        await expect.poll(async () => (await mediaState(page)).currentTime, {
            timeout: 20_000,
            message: `${browserName} did not resume its media clock after exhaustion`,
        }).toBeGreaterThan(resumedAt + 2);
        const recoveredAt = Date.now();

        expect(leaseRequests).toBe(1);
        expect(heartbeatRequests).toBeGreaterThan(0);
        expect(manifestRequests).toBeGreaterThan(1);
        expect(mediaRequests).toBeGreaterThanOrEqual(30);
        diagnosticEvents.push(...await page.evaluate(() => (
            (window as typeof window & { __hbNetworkDiagnostics?: unknown[] })
                .__hbNetworkDiagnostics ?? []
        )));
        expect(diagnosticEvents.length).toBeGreaterThan(0);
        expect(JSON.stringify(diagnosticEvents)).not.toMatch(/account|cookie|email|leaseId|token|url/i);
        await testInfo.attach('listener-network-evidence.json', {
            contentType: 'application/json',
            body: Buffer.from(JSON.stringify({
                schemaVersion: 1,
                browserName,
                bufferTargetSeconds: 180,
                achievedBufferSeconds,
                outageMediaSeconds: outageDurations,
                nearLimitOutageSeconds,
                exhaustionRecoveryMs: Math.max(0, recoveredAt - reconnectingObservedAt),
                leaseRequests,
                heartbeatRequests,
                manifestRequests,
                mediaRequests,
                diagnosticCount: diagnosticEvents.length,
            })),
        });
    });
});
